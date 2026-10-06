# D6 · Security pass

_Performed 2026-10-06 on branch `phase7-d6-security-pass`._ Box D6 of
[`phase-7-sequencing.md`](../phase-7-sequencing.md): a threat-model pass over the trust boundaries,
Dependabot plus a dependency and container scan in CI, and a recorded check of secure headers, the
CORS allowlist, the upload and report rate limits, and log redaction against P-14.

**Done-when: no open critical findings, and the checks run in CI.** Both hold. Trivy reports zero
critical and zero high findings in the API, web and MinIO images, and zero in the lockfile. `npm
audit` reports no critical or high advisories. Every check below is a test or a CI step, not a
one-off observation.

## Threat model

The system has six trust boundaries. For each: what crosses it, what an attacker on the far side
wants, and the control that stops it. A control marked **D6** was added or tightened by this pass.

| # | Boundary | Crosses it | Threat | Controls |
| - | -------- | ---------- | ------ | -------- |
| 1 | Browser → web app | Page loads | Clickjacking; an injected script calling out; a `blob:` preview making requests | **D6** `frame-ancestors 'none'` + `X-Frame-Options: DENY`; **D6** `connect-src` limited to the web origin and the API (the preview frames inherit it); `object-src 'none'`, `base-uri`, `form-action`; sandboxed preview frames |
| 2 | Browser → API | REST + Socket.IO, session cookie | CSRF, cross-origin reads, credential spraying, resource exhaustion | HTTP-only `SameSite` cookie + signed double-submit CSRF token; **D6** CORS allowlist of bare origins, HTTPS-only in production, one list shared by REST and the socket; login 5/min and account requests 3/min per client address; **D6** uploads 30/min and report exports 10/min per user; 120/min default; helmet headers |
| 3 | Authenticated user → another user's data | Document, file and report reads | IDOR, cross-division reads, confidential leakage | Deny-by-default scope predicates shared by every read path (`query-scope.ts`); confidentiality gate; UUIDs; authorization matrix and IDOR suites |
| 4 | Uploaded file → API, scanner, readers | Attachment bytes | Malware, type spoofing, macro documents, oversize uploads, stored XSS via preview | Magic-byte allow-list (P-06), macro refusal, 25 MB ceiling at the parser, ClamAV with fail-closed quarantine (P-07), `nosniff` + sandbox CSP + `no-store` on preview |
| 5 | API/worker → logs | Structured log lines | PII and credentials landing in a log store (P-14) | Credential-shaped keys and `key=value` pairs redacted; **D6** email addresses in any text, name and email fields, and error stacks redacted too |
| 6 | Third-party code → our images | npm packages, base images, the vendored MinIO server, CI actions | A known-vulnerable or hijacked dependency | **D6** `npm audit` + Trivy gate on CRITICAL in CI; **D6** Dependabot for npm, Actions, Docker and MinIO's Go modules; **D6** images run as `node` without npm or dev dependencies; **D6** Trivy pinned by commit (see below) |

Out of scope for this pass, as for the rest of Phase 7: the TLS ingress, host firewalling, and
monitoring/alerting. These belong to the UAT/pilot contingency.

## The recorded checks

Each check is a test that runs in CI's `quality` job, apart from the scans, which run in its
`security` job.

| Check | Where | What it asserts |
| ----- | ----- | --------------- |
| Secure headers (API) | `apps/api/test/http-edge.test.ts` | helmet's `nosniff`, `SAMEORIGIN`, HSTS, `no-referrer`, COOP and a CSP with `default-src 'self'` / `object-src 'none'`; no `X-Powered-By` |
| Secure headers (web) | `apps/web/test/security-headers.test.ts` | `DENY` framing, `connect-src` limited to the web origin and the API (with its `ws`/`wss` scheme), `blob:` allowed for preview frames only, the baseline headers |
| CORS allowlist | `http-edge.test.ts`, `environment.test.ts` | The configured origin is admitted with credentials; `https://evil.example`, a look-alike suffix and `null` are not reflected. A wildcard, a path, a trailing slash, or `http:` in production is refused at boot |
| OpenAPI UI | `http-edge.test.ts`, `environment.test.ts` | Served by default outside production, 404 in production unless `API_DOCS=true` |
| Rate limits | `http-edge.test.ts`, `rate-limit.test.ts` | Upload: 30 then 429. PDF and XLSX export: 10 each then 429. The on-screen report stays on the default bucket. The login and account-request windows are unchanged |
| Log redaction (P-14) | `apps/api/test/observability.test.ts` | Emails are removed from free text, including a Postgres `Key (email)=(…)` detail. `email`, `displayName` and `full_name` fields are removed while the user `id` is kept. An error's stack is redacted as well as its message |
| Dependency scan | CI `security` job | `npm audit --audit-level=critical` over the whole tree; Trivy over the lockfile and repository (vulnerabilities and secrets) |
| Container scan | CI `security` job | Trivy over `dts-api`, `dts-web` and `dts-minio:from-source`: HIGH and CRITICAL printed, CRITICAL fails the job |

The headers were also checked in a real browser against the rebuilt stack. Logging in, the
dashboard, the attachment preview and the realtime socket all work under the new web policy, and a
`fetch` to an outside host is blocked with a `connect-src` violation.

## Findings

| # | Severity | Finding | Disposition |
| - | -------- | ------- | ----------- |
| F1 | High | The web app sent no security headers: it could be framed, and an injected script or a trusted PDF's preview frame could call anywhere | **Fixed.** `security-headers.ts` is applied to every route by `next.config.ts` |
| F2 | High | Container images: the API and web images ran as root. The API image shipped every dev dependency. Both bundled npm, whose own dependencies held 7 HIGH advisories | **Fixed.** Both images run as `node`, the API image prunes dev dependencies, and npm, npx, corepack and yarn are removed from both runtimes. Trivy: 0 HIGH, 0 CRITICAL in each |
| F3 | Critical (unreachable) | MinIO, built from vendored source on Go 1.24, had 4 CRITICAL and 54 HIGH findings. The criticals were three in the RabbitMQ AMQP client and one in gRPC's `authz` package; MinIO uses neither here. The highs were Go stdlib, `x/crypto`, `x/net`, gRPC, otel, prometheus, thrift, jose and jsonparser | **Fixed.** The modules were bumped and the build moved to Go 1.26.8 on Alpine 3.22. Trivy: 0 HIGH, 0 CRITICAL. The integration suites (87 tests, including the real-MinIO file and scanner suites) pass against the rebuilt server |
| F4 | Medium | Log redaction handled credentials but not P-14's other half: email addresses in messages (e.g. a unique-violation detail) and name/email fields reached the log. An error's stack, which repeats its message, was passed through unredacted, so even a redacted `token=` reappeared in it | **Fixed** in `structured-logger.ts` |
| F5 | Medium | `/api/docs` mapped every route and schema on the public hostname in production | **Fixed.** Off in production unless `API_DOCS=true` |
| F6 | Medium | Upload and report export sat on the 120/min default. Each upload buffers up to 25 MB and queues a scan; each export renders a month in-process | **Fixed.** 30/min and 10/min per format, per user |
| F7 | Low | `WEB_ORIGIN` was read raw by `main.ts` (untrimmed) and separately by the gateway (trimmed). A space after a comma, or a trailing slash, silently broke CORS. `http:` was accepted in production, where the `Secure` cookie can never be sent | **Fixed.** `parseWebOrigins` is the one parser, used for the validated environment and the gateway |
| F8 | High (build tool) | `source-map-js` 1.2.1 (event-loop DoS) | **Fixed.** `npm audit fix` moved it to 1.2.2 |

### Accepted, with reasons

| Advisory | Severity | Path | Why it stays |
| -------- | -------- | ---- | ------------ |
| `decode-uri-component`, `query-string`, `stream-json` | Moderate | `minio` (the npm client) 8.0.7 | 8.0.7 is the newest release; `npm audit` offers only a downgrade to 7.1.3. The vulnerable code parses responses from our own MinIO server on the internal network, not user input. Dependabot will raise the client when a fixed release appears |
| `esbuild`, `@esbuild-kit/*` via `drizzle-kit` | Moderate | Dev tooling | The esbuild dev-server advisory needs `esbuild serve`, which nothing here runs. `drizzle-kit` only generates migrations on a developer's machine and is pruned from the image |

## Trivy is pinned by commit

On 2026-03-19 an attacker force-pushed 76 of `aquasecurity/trivy-action`'s 77 tags to
credential-stealing code ([GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)).
A tag is a pointer that anyone holding the credentials can move. CI therefore references the
action by commit: `ed142fd0…` is v0.36.0, an immutable release published a month after the cleanup.
The scanner binary is pinned to v0.75.0, also an immutable release. The action installs that binary
through `setup-trivy`, which it in turn pins by commit.

CodeQL was the alternative the box names. It was not used, because the repository is private and
code scanning is not enabled on it. CodeQL's SARIF upload would fail, and its results would have
nowhere to land. Trivy needs no repository setting.

## To do outside the repository

- **Enable Dependabot alerts** in the repository's security settings. The committed
  `dependabot.yml` drives version-update PRs; vulnerability alerts are a separate switch.
- **Production `WEB_ORIGIN`.** Set it to the pilot's HTTPS origin. Boot now refuses an `http:` one
  in production.
