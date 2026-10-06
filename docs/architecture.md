# Architecture overview

_Last reviewed: 2026-10-01._

What this system is made of, layer by layer, and why each layer looks the way it does. It is the
orientation document: read it first, then follow the pointers.

| For…                                      | Read                                                 |
| ----------------------------------------- | ---------------------------------------------------- |
| Product intent, the 151 decisions, phases | [CONTEXT.md](CONTEXT.md)                             |
| Why a load-bearing choice was made        | [adr/](adr/)                                         |
| What is real today, what to build next    | [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) |
| Institution-owned questions still open    | [policy-register.md](policy-register.md)             |
| The in-flight UI migration                | [frontend-rebuild-plan.md](audits/frontend-rebuild-plan.md) |

---

## 1 · The project

A **Document Tracking System (DTS)** for a single government bureau. It replaces paper routing
slips and fragmented email tracking with one accountable record per incoming or outgoing document.
Greenfield build, one full-stack developer at 20–25 h/week, capacity-gated rather than
deadline-driven.

The authority chain is explicit: [CONTEXT.md](CONTEXT.md) is the source of truth, then the
[attached specification](Document-management-tracking-system.md), then the prior prototype as
_implementation evidence, not authority to narrow the target_.

**MVP boundary** — one complete predefined-workflow vertical slice for the Records Office plus one
pilot division: registration → routing → revision → signature → release → archive, with immutable
file versions, metadata search, PDF/XLSX core reports, persistent realtime notifications,
role-and-scope enforcement, Docker Compose development, and a separately hosted pilot with a
_rehearsed_ restore. Explicitly deferred (CONTEXT.md → _Later-phase security and operations
enhancements_): MFA/SSO, SIEM, high availability, email/SMS channels, a workflow designer, OCR,
multi-tenancy.

**Core domain language** (full glossary in CONTEXT.md → _Canonical language_):

- Organization › **Division** › **Section** — custody and scope live here; say "division," never
  "department."
- **Document** — the tracked business record, not an uploaded file. Carries a **tracking number**
  (system identity) _and_ a separate **reference number** (the sender's, for incoming; allocated
  per division, for outgoing).
- **Custody / Assignment / Route / Forward** — four distinct accountability moves.
- **File version** — immutable bytes plus digest and uploader. Replacement creates a new version
  and never overwrites.
- **Workflow state** — `Pending → In Process ↔ For Revision → For Signature → Signed → For Release
  → Released → Archived`.

## 2 · Repository layout

npm workspaces, three packages:

| Package                                                | Role                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| [`@dts/api`](../apps/api)                              | NestJS modular monolith plus a worker process               |
| [`@dts/web`](../apps/web)                              | Next.js App Router client                                   |
| [`@dts/contracts`](../packages/contracts/src/index.ts) | Zod schemas and inferred types shared by both sides         |

`@dts/contracts` must be built before anything typechecks (`npm run build -w @dts/contracts`) — the
workspace symlinks resolve to its `dist/`.

## 3 · Runtime topology

```
apps/web (Next 16 App Router, :3000)
      │  fetch, session cookie + CSRF header       socket.io
      ▼                                               ▲
apps/api  main.ts (:4000, /api/v1)  ──Redis pub/sub───┤
      │  modules/*  (controller → service → repository → policy)
      ▼                                               │
  Postgres (Drizzle) ── outbox_events ──► BullMQ ──► apps/api worker.ts (:4001 health)
  MinIO (object bytes)                                (outbox relay, ClamAV scans, exports)
          ▲──────────────────── scan verdict ─────────┘
```

Two processes, one codebase ([ADR-0001](adr/0001-modular-monolith.md)). The worker exists only so
slow work — virus scanning, exports, outbox draining — cannot block HTTP request handling. It is a
plain Node process that builds its collaborators by hand rather than through Nest DI, and serves
its own `/health` and `/ready`.

## 4 · Backend stack

| Layer      | Choice                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| Runtime    | Node 22+, ESM, TypeScript 6                                                                |
| Framework  | NestJS 12 on the Express platform, global prefix `/api/v1`                                 |
| Validation | Zod 4 through a custom `ZodValidationPipe` over the shared contracts                       |
| ORM        | Drizzle 0.45 + `pg` — migration-controlled; destructive schema sync prohibited             |
| Auth       | `@nestjs/jwt` + bcryptjs, credential carried in an HTTP-only cookie                        |
| Queues     | BullMQ 6 on ioredis                                                                        |
| Realtime   | socket.io via `@nestjs/websockets`                                                         |
| Storage    | MinIO SDK behind a `StoragePort` abstract class                                             |
| Scanning   | ClamAV over raw TCP ([clamav-scanner.ts](../apps/api/src/modules/files/clamav-scanner.ts)) |
| Exports    | pdfkit (PDF), fflate (hand-rolled XLSX)                                                    |
| Hardening  | helmet, `@nestjs/throttler`, cookie-parser, `file-type` magic-byte checks                  |
| API docs   | `@nestjs/swagger` → `/api/docs`; off in production unless `API_DOCS=true`                  |

### Module structure

Eleven bounded contexts live as **modules inside one process**, not as network services
([ADR-0001](adr/0001-modular-monolith.md)). Each owns its own controller / service / repository /
policy and its own tables; a module may depend on another only through a service interface, never
by querying a foreign module's tables.

| Module                                                   | Owns                                                                   |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`auth`](../apps/api/src/modules/auth)                   | Login/logout, JWT issuance, session service                            |
| [`identity`](../apps/api/src/modules/identity)           | Account requests, users, profile photos, `/me`                         |
| [`authorization`](../apps/api/src/modules/authorization) | Role capabilities, policies, the shared query-scope predicates         |
| [`organization`](../apps/api/src/modules/organization)   | Division and section CRUD                                              |
| [`documents`](../apps/api/src/modules/documents)         | The document aggregate, SQL search, metadata revisions                 |
| [`workflow`](../apps/api/src/modules/workflow)           | The finite-state machine and transition legality                       |
| [`files`](../apps/api/src/modules/files)                 | File records and versions, `StoragePort`, MinIO adapter, scan consumer |
| [`notifications`](../apps/api/src/modules/notifications) | The durable inbox and read state                                       |
| [`realtime`](../apps/api/src/modules/realtime)           | WebSocket gateway, Redis bridge, publisher                             |
| [`reports`](../apps/api/src/modules/reports)             | Monthly calculations, XLSX/PDF export, routing slip                    |
| [`audit`](../apps/api/src/modules/audit)                 | Append-only `AuditWriter` and transactional `OutboxWriter`              |
| [`jobs`](../apps/api/src/modules/jobs)                   | Outbox queue and relay                                                 |

Plus three thin surfaces: `admin` (audit query), `dashboard` (scoped summary), `health`.

Everything is wired in a single [app.module.ts](../apps/api/src/app.module.ts), using abstract
classes as DI tokens — `StoragePort`, `AuditWriter`, `OutboxWriter` — so unit suites substitute
in-memory implementations while the running app and the integration suites get the real ones.

Cross-cutting concerns sit in [src/common](../apps/api/src/common): `AuthGuard`, `CsrfGuard`, a
global throttler, `HttpErrorFilter` (the stable success/error envelope and machine-readable codes),
correlation-ID middleware, a PII-redacting structured logger, and the Zod pipe.

## 5 · Frontend stack

| Layer           | Choice                                                     |
| --------------- | ---------------------------------------------------------- |
| Framework    | Next.js 16 App Router, React 19                       |
| Styling      | Tailwind v4 (`@tailwindcss/postcss`) with shadcn/ui and an M3 Expressive appearance |
| Server state | TanStack Query 5                                      |
| Realtime     | socket.io-client                                      |
| Feedback     | sonner toasts plus skeletons                          |
| Forms        | react-hook-form + `zodResolver` over `@dts/contracts` |
| Tests        | Vitest + Testing Library + jsdom                      |

**The rebuild is done** (F0–F2 of [frontend-rebuild-plan.md](audits/frontend-rebuild-plan.md)): `DtsApp` and
the bespoke `globals.css` are gone, and every surface the MVP boundary
names is routed. Two App Router groups divide the app by who may enter:

- `app/(public)` — sign in, and the account request form.
- `app/(app)` — everything behind the session gate, inside the shared `AppShell`: the dashboard, the
  registry and a document's own route, `/my-work`, `/reports`, `/audit`, and the `/admin` console
  (account requests, users, organization). Notifications stay a sheet opened from the shell rather
  than a route of their own.

Data lives in per-feature query modules under `src/features/<domain>/queries.ts`, each owning its
own query keys _and_ its invalidation, so screens never see a cache key and the realtime adapter
can invalidate a document without knowing how documents are cached. The shared list components
(`DataTable`, `FilterBar`, `PageHeader`, `EmptyState`) are in `src/components/dts/`, and the
shadcn primitives they are built from are owned source in `src/components/ui/`.

The UI selector in the public forms and authenticated shell saves `shadcn` or `md3` per browser,
independently of the light/dark setting. The root layout applies both choices before paint. The
M3 Expressive treatment lives in `app/md3-expressive.css` and covers the owned controls and DTS
compositions; it keeps their React and Radix behavior, forms, queries, and authorization paths.

Capabilities come from the `capabilities[]` that `/auth/me` returns — the client never derives
authority from `role`. The same list gates the navigation, whose administrative group disappears
entirely rather than showing a heading over nothing, and `<RequireCapability>` on each admin route.
Both are courtesies: the API enforces the identical capability on every request, so the point is that
nobody is shown a screen whose every action would be refused.

## 6 · Shared contracts

[`@dts/contracts`](../packages/contracts/src/index.ts) is one module of Zod schemas: the workflow
state and action enums, roles, direction/priority/release-method enums, the strong-password rule,
and a schema per request shape (login, account-request submit/approve/reject, user and
division/section CRUD, create document, workflow command, metadata update, assign, route, share,
scan result), each with its inferred type exported alongside.

The API's validation pipe and the client's form resolvers consume the **same** schema, so a field
rule cannot drift between the two sides.

## 7 · Data layer

Twenty Drizzle tables in [schema.ts](../apps/api/src/database/schema.ts):

- **Organization** — `divisions`, `sections`, `users`, `profile_photos`, `account_requests`
- **Counters** — `reference_counters`, `document_sequences`
- **Documents** — `documents`, `document_metadata_revisions`, `document_assignments`,
  `document_shares`, `document_routes`, `workflow_events`
- **Files** — `file_records`, `file_versions`, `signature_events`, `release_events`
- **Evidence and integration** — `notifications`, `audit_events`, `outbox_events`

Table conventions are centralized in
[schema-helpers.ts](../apps/api/src/database/schema-helpers.ts): `identityColumns()` gives every
table a UUID primary key, `timestamptz` created/updated columns, and the `version` integer used for
optimistic concurrency. The convention is enforced by a test
([schema-conventions.test.ts](../apps/api/test/schema-conventions.test.ts)) rather than by reviewer
memory.

Two invariants define this layer:

1. **One transaction per use case.** Every state change writes its domain row **plus** its
   `workflow_event`, `audit_event` and `outbox_event` together. This is the reason the system is a
   monolith: a plain `BEGIN … COMMIT` replaces sagas and eventual consistency
   ([ADR-0001](adr/0001-modular-monolith.md)).
2. **Evidence is append-only.** `audit_events` and committed `file_versions` have no update path
   through application code, and actor identity survives account deactivation.

Identifiers are deliberately two things, not one: UUID surrogate keys for joins and URLs, and
human-facing reference numbers allocated from a `reference_counters` row _inside_ the create
transaction ([ADR-0003](adr/0003-identifier-strategy.md)).

## 8 · Infrastructure

One `docker-compose.yml` topology, the **same** for local development and the pilot host — only
`.env` differs ([ADR-0004](adr/0004-deployment-model.md)):

| Service    | Image                      | Role                                       |
| ---------- | -------------------------- | ------------------------------------------ |
| `postgres` | `postgres:16-alpine`       | System of record                           |
| `redis`    | `redis:7-alpine` (AOF)     | BullMQ queues and realtime pub/sub         |
| `minio`    | `dts-minio:from-source`    | Private object store for file versions     |
| `clamav`   | `clamav/clamav:stable`     | Malware scanner, fail-closed (~2 GB RAM)   |
| `migrate`  | api image, `restart: 'no'` | One-shot migration runner that gates `api` |
| `api`      | api image                  | HTTP API                                   |
| `worker`   | api image, `worker.js`     | Outbox relay, scans, exports               |
| `web`      | web image                  | Next.js client                             |

Startup order is expressed as health dependencies, never sleeps: `api` waits for its four
dependencies to be `service_healthy` **and** for `migrate` to be
`service_completed_successfully`, so the API can never serve traffic against an un-migrated schema.
Every stateful service uses a named volume, never a bind mount, so backup and restore operate on
one documented set.

[scripts/backup.sh](../scripts/backup.sh) and [restore.sh](../scripts/restore.sh) treat Postgres
and MinIO as a **coordinated pair** — a database restored to a point where MinIO lacks the
corresponding object is a corrupt system. Single host means no automatic failover:
restore-from-backup _is_ the availability plan, which is why the phase-7 recovery rehearsal is not
optional.

Configuration is nineteen environment variables validated at boot by
[environment.ts](../apps/api/src/config/environment.ts), which refuses to start on
`NODE_ENV=production` with `COOKIE_SECURE=false`, on `SameSite=None` combined with an insecure
cookie, or on a `SESSION_SECRET` shorter than 32 characters.

**Behind the ingress.** The pilot is reached through TLS ingress (CONTEXT.md decision 136), so
without help every request appears to come from the ingress address. `TRUST_PROXY` tells Express
which hops may speak for the client through `X-Forwarded-For`: a hop count (`1` for one ingress)
or the ingress addresses/CIDRs. It defaults to off, which ignores the header — correct for local
development, wrong for the pilot, where the whole office would then share one 120/min bucket and
one 5/min login window. `true` is refused at boot, because trusting every hop makes the left-most,
client-written entry the address the API rate-limits and audits. Rate-limit buckets are keyed per
signed-in user (the session is verified in the global guard) and otherwise per client address;
login and account requests stay keyed per client address regardless of any session cookie.

## 9 · Security posture

Decisions 89–134 of CONTEXT.md, realized as:

- **Deny by default.** Role capabilities and organizational scope are centrally defined, and the
  _same_ scope predicates back every read, search, dashboard, export and render path
  ([query-scope.ts](../apps/api/src/modules/authorization/query-scope.ts)) — not re-derived per
  controller.
- **Shares are modeled, not bypasses.** Cross-division access exists only through auditable
  `document_shares` / `document_routes` rows.
- **Session.** A JWT signed with `SESSION_SECRET`, carried in the HTTP-only `dts_session` cookie,
  so page scripts cannot read it. The price of an ambient credential is CSRF risk, paid for with
  `SameSite` plus an explicit token on mutations, and a CORS allowlist with `credentials: true`.
  The token is stateless, so the 30-minute default expiry bounds the post-logout window
  ([ADR-0002](adr/0002-session-transport.md)).
- **Non-enumerable URLs.** Random UUIDs mean a shared document URL leaks no volume or ordering and
  cannot be walked. Server-side authorization is still the control; unguessability is defence in
  depth ([ADR-0003](adr/0003-identifier-strategy.md)).
- **Uploads.** An allow-list verified by magic bytes, a size ceiling, a server-generated storage
  key (the uploaded filename is untrusted display data), and a SHA-256 digest per version.
- **Downloads fail closed.** A version that is not `CLEAN` is never served. The in-page preview route
  shares that one read path rather than repeating it, so the quarantine check cannot be present on one
  and missing from the other; it serves only browser-renderable types, with `nosniff`, a
  `default-src 'none' … sandbox` CSP and `private, no-store`, into a sandboxed frame. Reading bytes on
  screen and taking a copy away are separate audit actions.
- **Deletion is logical and reversible.** A deleted document leaves every read path, including its own
  route; the only way back is `GET /documents/deleted`, itself filtered per row by the same scoped
  `DOCUMENT_RESTORE` predicate the restore endpoint applies.
- **Exports.** Formula-injection-safe XLSX and safe filenames; reports and routing slips render
  from authoritative server data.
- **Errors and logs.** Generic client messages, correlation IDs retained for support, and
  structured logs that redact credential-shaped values, email addresses anywhere in the text, and
  name and email fields (P-14) — error stacks included, since a stack repeats its message.
- **The HTTP edge.** One function, [http-app.ts](../apps/api/src/http-app.ts), sets helmet's headers,
  the CORS allowlist (`WEB_ORIGIN`: bare origins only, HTTPS in production, shared with the
  Socket.IO handshake) and whether the OpenAPI UI is served; `http-edge.test.ts` asserts what it
  produces. The web app sends its own policy ([security-headers.ts](../apps/web/src/lib/security-headers.ts)):
  no framing, and `connect-src` limited to itself and the API, which also binds the `blob:` preview
  frames. Uploads (30/min) and report exports (10/min per format) have rate limits of their own.
- **Supply chain.** Images run as `node`, carry no dev dependencies and no npm. CI fails on a
  critical advisory (`npm audit`, Trivy over the lockfile and all three built images) and
  Dependabot proposes the upgrades weekly. Detail and the threat model:
  [d6-security-pass.md](evidence/d6-security-pass.md).

## 10 · Testing and CI

Sixty-six test files across three Vitest projects:

| Suite                                                       | What it proves                                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| API unit ([vitest.config.ts](../apps/api/vitest.config.ts)) | The FSM, RBAC and scope, guards, env validation, report math — with `StoragePort`/`AuditWriter`/`OutboxWriter` overridden in memory |
| API integration (`*.int.test.ts`)                           | Real Postgres and Redis: migrations, query scope, documents, files, notifications, realtime                                   |
| Web ([vitest.config.ts](../apps/web/vitest.config.ts))      | Transport, query client and component behaviour under jsdom                                                                   |

[CI](../.github/workflows/ci.yml) runs two jobs on every push: **quality** (format → lint →
typecheck → unit → build → `docker compose config --quiet`) and **integration** against a Postgres
service container. The same gate locally is `npm run quality`, with a husky pre-commit running
lint-staged over changed files.

## 11 · Governance documents

| Document                                             | Purpose                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [CONTEXT.md](CONTEXT.md)                             | The 151 decisions, canonical language, MVP acceptance boundary, phase roadmap                     |
| [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) | Audited status **and** the backlog, as ~70 single-session boxes in dependency order                |
| [adr/](adr/)                                         | One file per load-bearing decision; immutable once `Accepted`, changed only by a superseding ADR  |
| [policy-register.md](policy-register.md)             | The 14 institution-owned questions, each with the provisional default the code currently carries  |
| [frontend-rebuild-plan.md](audits/frontend-rebuild-plan.md) | The shadcn migration: decisions, module design, routes, phases                                    |
| [agents/issue-tracker.md](agents/issue-tracker.md)   | Working notes for agent-driven tasks                                                              |

The policy register is the one worth internalizing: a question lands there the moment code needs an
answer, so that no placeholder heuristic silently becomes permanent behaviour. Every `OPEN` and
`PROVISIONAL` row must reach `AGREED` before phase-7 readiness sign-off.

## 12 · Where it stands

**Backend: feature-complete through phase 6.** The old `Map`-backed `DtsApplicationService` is
retired; identity, organization, documents, workflow, files, notifications, reports and audit are
all persisted to Postgres. The runtime is fully wired — attachment bytes go to MinIO through the
storage port, the worker auto-scans each upload through ClamAV and records the verdict, and
notifications fan out over an authenticated WebSocket gateway fed by Redis.

**Frontend: rebuilt and feature-complete for the pilot.** The whole shadcn rebuild has landed — the
operational workspace (login, registry, document route, attachments with scan-gated download and
inline preview, notifications, reports), the scope-aware dashboard and assigned-work queue, the audit
viewer, the admin console, the public account-request form, and capability-gated delete/restore with
the routing-slip download.

**Not yet built:** the ⌘K command palette, and Phase 7 itself — acceptance, the axe and
responsive/browser sweeps, Playwright E2E, the backup-and-restore rehearsal, and handover. The
policy register's `OPEN` and `PROVISIONAL` rows also have to reach `AGREED` before readiness
sign-off.

The current task-level truth is always [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md), not
this section.
