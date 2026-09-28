# DTS — Coding Breakdown by Phase

Companion to `dts-developer-assignment.md`. This version is written the way a developer works: **repo layout → schema → endpoints → task order → tests → PR slices → done-when.**

> Names below (folders, tables, files) are **suggested conventions** derived from the plan's module boundaries, ER model, and endpoint list. Adjust to repo standards, but keep the module boundaries (Identity, Authorization, Organization, Documents, Workflow, Routing, Files, Notifications, Reports, Audit, Outbox/Jobs).

---

## Global conventions (set once in Phase 0, obey forever)

**Rules for every slice**
- One PR = one vertical slice increment: migration + API + UI + tests. No "backend-only" or "UI-only" PRs unless it's scaffolding.
- Status/state changes go through domain services only. Controllers never write `workflow_status`.
- Every state-changing use case runs in **one DB transaction**: domain change + `workflow_event` + `audit_event` + `outbox_event` (+ notification rows).
- Every read (list, detail, count, export, file, realtime) passes through the authorization policy. Deny by default.
- Editable aggregates carry a `version` column → stale write returns `409 Conflict`.
- Runtime-validate all inputs (shared schema, e.g. Zod) at the API boundary; safe error envelope `{ code, message, details?, correlationId }`.

**Suggested repo layout**
```
/apps
  /api            # NestJS: modules/, common/, main.ts
  /worker         # BullMQ processors (same domain contracts)
  /web            # Next.js App Router
/packages
  /contracts      # shared request/response schemas + types
  /db             # Drizzle schema, migrations, seeds
  /config         # env validation, shared tsconfig/eslint
/infra
  docker-compose.yml, scanner config, backup scripts, runbooks
/docs
  adr/, policy-register.md, uat/
```

**Per-module backend shape**
```
modules/<name>/
  <name>.controller.ts     # HTTP only, thin
  <name>.service.ts        # use cases / commands
  <name>.repository.ts     # Drizzle queries (authorization predicates included)
  <name>.policy.ts         # authz rules for this module
  dto/                     # schemas from packages/contracts
  <name>.spec.ts / .int.spec.ts
```

---

## Phase 0 — Foundations (Wk 1–3)

**Goal:** a repo where a new machine runs the whole stack, CI is green, and schema/ops conventions exist before any feature.

**Tasks (in order)**
1. Init monorepo, TS configs, lint/format, commit hooks.
2. `docker-compose.yml`: postgres, redis, minio, scanner, api, worker, web; health checks; named volumes.
3. Env validation module (fail fast on missing/invalid config).
4. Drizzle setup: migration runner, `id` (uuid) / `created_at` / `updated_at` / `version` base helpers.
5. Core tables: `audit_event`, `outbox_event`.
6. Common infra: correlation-ID middleware, structured logger, global exception filter (safe envelope), `/health` + `/ready`.
7. CI: lint → typecheck → unit → integration (Postgres service) → build.
8. Docs: ADRs (modular monolith, session transport, ID strategy), deployment decision record, policy register.

**Tests**
- Health endpoint smoke; migration up on empty DB; env validation failure test.

**PR slices:** `chore/repo-scaffold` · `chore/compose-stack` · `feat/db-conventions` · `feat/observability-baseline` · `chore/ci-pipeline`

**Done when:** clean machine → `docker compose up` → healthy stack; CI green; no infra blocker from IT.

---

## Phase 1 — Identity & Organization (Wk 4–6)

**Goal:** people can request/receive accounts, log in, and every request is scoped by role + division/section.

**Schema**
- `division`, `section (division_id)`, `user (division_id, section_id, status, password_hash, photo_key)`, `role`, `user_role`, `account_request`, `session` (if server sessions).

**Endpoints**
```
POST /auth/login          POST /auth/logout
POST /account-requests    GET  /account-requests        POST /account-requests/{id}/approve|reject
POST /users               PATCH /users/{id}             POST /users/{id}/deactivate
GET/POST/PATCH /divisions, /sections
GET  /me                  POST /me/photo
```

**Backend tasks**
1. Identity module: bcrypt hashing, session/cookie issuance (HTTP-only, SameSite), inactivity expiry, CSRF protection.
2. Rate-limit guard (login, account-request).
3. Organization module CRUD + membership rules.
4. Admin flows: approve/reject, role assignment, deactivate (soft — keep identity for history).
5. **Authorization module:** `Policy` interface, `can(actor, action, resource)`, plus **query scoping helpers** (`scopeToActor(query, actor)`) — reused by every later repository.
6. Audit writer wired into all admin/auth actions.

**Frontend tasks**
- Login, request-account form, admin user table, approve/reject dialogs, division/section manager, profile + photo upload, session-expired handling.

**Tests**
- Auth: wrong password, lockout/rate limit, expiry, CSRF, no credential in logs.
- **Authorization matrix test** (table-driven: 5 roles × resources × actions) incl. cross-division and guessed-ID negatives.

**PR slices:** `feat/auth-session` · `feat/account-requests` · `feat/org-admin` · `feat/authz-policies-and-scoping`

**Done when:** matrix passes positive + negative; no list/detail/count/admin endpoint leaks data.

---

## Phase 2 — Document registry (Wk 7–9)

**Goal:** register, view, edit, list, and search documents end to end with scoped access.

**Schema**
- `document (direction, title, type, description, priority, sender, company, external_ref, reference_number UNIQUE, workflow_status, owner_division_id, version, deleted_at)`
- `document_metadata_revision`, `workflow_event`, `reference_counter (division_id, scope_key, next_value)`

**Endpoints**
```
POST  /documents            GET /documents            GET /documents/{id}
PATCH /documents/{id}/metadata      (If-Match / version)
```

**Backend tasks**
1. Document create use case (incoming keeps external ref; outgoing allocates reference).
2. **Reference allocation:** `SELECT … FOR UPDATE` (or atomic `UPDATE … RETURNING`) on `reference_counter` inside the create transaction.
3. Metadata edit with optimistic version check → writes `document_metadata_revision` + audit.
4. List query: keyset/limit pagination, deterministic sort, filters (status, priority, type, direction, division, section), search on title/reference/sender/company — **authorization predicates in the SQL**, never post-filtered in app memory.
5. Add indexes only after `EXPLAIN` on seeded representative data (B-tree, trigram if measured).

**Frontend tasks**
- Create form (incoming/outgoing variants), detail page + timeline, edit metadata with conflict UX, list with filters/sort/pagination/search.

**Tests**
- Concurrency: N parallel outgoing creates → N unique references.
- Conflict: two edits → second gets 409.
- Search/filter authorization; empty/malformed/boundary inputs; pagination stability.

**PR slices:** `feat/document-create` · `feat/reference-allocation` · `feat/metadata-edit-history` · `feat/document-list-search`

**Done when:** records staff can register + retrieve; no duplicate refs; counts and results respect scope.

---

## Phase 3 — Workflow & routing (Wk 10–13)

**Goal:** full predefined workflow enforced by the server, with assignments and multi-division routing.

**Schema**
- `document_assignment`, `document_route`, `document_share`, `signature_event`, `release_event (method)`, remarks (on `workflow_event`).

**Endpoints**
```
GET  /documents/{id}/allowed-actions
POST /documents/{id}/actions/{action}     # accept, return, resubmit, submit-signature, sign,
                                          # prepare-release, release, archive, restore
POST /documents/{id}/routes               # + assignment/share endpoints
```

**Backend tasks**
1. **Transition table as data:** `{ from, action, to, allowedRoles, guards[] }`. One `WorkflowService.apply()` is the only writer of `workflow_status`.
2. Guards as small pure functions (`requiresRemark`, `requiresCleanAttachment`, `requiresSignature`, `actorInScope`).
3. `allowed-actions` = filter the table by actor + state + assignment.
4. Assignment + section routing (downward), pending acceptance, work queue queries.
5. Parallel routes: routes/shares reference the **same** document row; completion semantics per agreement; block duplicate routes.
6. Signature (internal record), release (record method: mailed/emailed/picked up/delivered), archive/restore.
7. Return-for-revision requires remark (validated).

**Frontend tasks**
- Action bar driven by `allowed-actions` (never hard-code button logic), remark dialogs, assign/route pickers, work-queue views, timeline with per-route visibility.

**Tests**
- **Table-driven:** every legal transition passes; every other (from,action) pair is rejected.
- Race: two actors act simultaneously → one wins, one gets conflict.
- Scope: Viewer cannot act; cross-division actor cannot route/see.
- Release blocked without signature (attachment check wired in Phase 4).

**PR slices:** `feat/workflow-engine` · `feat/assignment-section-routing` · `feat/parallel-routes` · `feat/sign-release-archive`

**Done when:** every legal path works E2E, illegal ones 4xx, ownership/location unambiguous after each action.

---

## Phase 4 — Files & scanning (Wk 14–16)

**Goal:** private, immutable, scanned files; nothing downloadable unless CLEAN.

**Schema**
- `file_record (document_id)`, `file_version (file_record_id, version_number, object_key, checksum, size, mime, scan_status)`, `file_scan (file_version_id, result, attempts, scanned_at)`; unique `(file_record_id, version_number)`.

**Endpoints**
```
POST /documents/{id}/files            POST /files/{id}/versions
GET  /files/{id}/versions/{vid}/content
```

**Backend tasks**
1. Storage port + MinIO adapter (`put`, `getStream`, no overwrite — random non-guessable keys).
2. Upload use case: authorize → size/type limits at ingress → insert `PENDING` version → stream to quarantine prefix → checksum → enqueue scan (via outbox).
3. Scan worker: stream to scanner, set `CLEAN` / `INFECTED` / `SCAN_FAILED`; bounded retries; **fail closed**.
4. Content endpoint: authorize → require `CLEAN` → short-lived access; safe `Content-Type`/`Content-Disposition`, `nosniff`, CSP; no inline for active types.
5. Wire release guard: outgoing needs ≥1 CLEAN attachment + signature.

**Frontend tasks**
- Multi-file upload with per-version status chips, version history, PDF/image preview, download, infected/failed messages.

**Tests**
- Scanner: clean / infected / down / timeout; spoofed extension; oversize.
- IDOR: guess object key, other division's file id, direct URL → all denied.
- Version immutability: no update/delete path exists; range/large-file download.

**PR slices:** `feat/storage-adapter-versions` · `feat/quarantine-scan-worker` · `feat/preview-download` · `feat/release-invariant`

**Done when:** no unscanned/non-clean object is retrievable; outgoing release invariant enforced.

---

## Phase 5 — Outbox, notifications, dashboard (Wk 17–19)

**Goal:** committed events are never lost; users get notifications live and after reconnect.

**Schema**
- `notification (user_id, type, document_id, read_at, seq)`; outbox columns: `status`, `lease_until`, `attempts`, `idempotency_key`.

**Endpoints**
```
GET  /notifications?cursor=      POST /notifications/{id}/read
GET  /dashboard/summary          (+ realtime channel)
```

**Backend tasks**
1. **Outbox publisher:** lease unpublished rows (`FOR UPDATE SKIP LOCKED`) → enqueue idempotent BullMQ job → mark published.
2. Job conventions: name, payload schema, idempotency key, backoff, dead-letter + inspection.
3. Notification audience resolver (from assignment/route/workflow events); rows written in the domain transaction.
4. Realtime gateway: authenticated subscribe, authorized fan-out, cursor catch-up on reconnect, unread-count reconciliation.
5. Dashboard queries reusing the same scoped list predicates (single source of truth).

**Frontend tasks**
- Notification bell + inbox, unread badge, mark-read, reconnect/catch-up, dashboard cards, pending-by-division chart, activity feed, quick accept/assign, overdue highlighting.

**Tests**
- Kill worker between commit and publish → event still delivered exactly once (effect-wise).
- Duplicate delivery, Redis restart, poison job.
- Offline → reconnect → no duplicates, correct order; multi-tab; subscription can't receive other-division events.
- Dashboard totals == underlying list query counts.

**PR slices:** `feat/outbox-publisher` · `feat/notifications-persist-realtime` · `feat/dashboard`

**Done when:** notifications survive disconnect and API/worker restart; dashboard reconciles.

---

## Phase 6 — Reports, routing slip, audit UI (Wk 20–21)

**Goal:** operational exports and evidence viewing.

**Endpoints**
```
GET /reports/monthly  |  /reports/monthly.pdf  |  /reports/monthly.xlsx
GET /documents/{id}/routing-slip.pdf
GET /audit-events?user=&action=&from=&to=
```

**Backend tasks**
1. Report definition module: explicit aggregate queries (incoming/outgoing/FOI/special-order per month), scope-aware.
2. PDF + XLSX generators; **sanitize cells starting with `= + - @`** (formula injection); audit each export.
3. Routing slip renderer: branding config, timeline, remarks, statuses.
4. Audit query API (insert + read only for app DB role), filters, pagination; restrict to auditor/admin scope.

**Frontend tasks**
- Report page (month/year filter, print view, export buttons), routing-slip print action, audit table + filters.

**Tests**
- Fixture data → totals reconcile; PDF/XLSX open/validate; boundary months; cross-scope leakage; formula-injection payloads; audit rows immutable at app boundary.

**PR slices:** `feat/monthly-reports` · `feat/report-exports-safe` · `feat/routing-slip` · `feat/audit-viewer`

**Done when:** records staff sign off totals; routing slip approved; every critical scenario traceable in audit.

---

## Phase 7 — Hardening & readiness (Wk 22–24)

**Goal:** prove it's safe, fast, accessible, and recoverable.

**Tasks**
1. **A11y pass:** keyboard/focus order, labels, contrast, reduced motion, loading/empty/error/success states, viewport matrix.
2. **Performance:** seed pilot-sized data; `EXPLAIN` critical queries; add/adjust indexes; fix N+1s; large-list behavior.
3. **Security:** threat-model pass, rate limits on upload/report, secure headers, CORS allowlist, dependency + container scans, log redaction check.
4. **Ops:** backup scripts for Postgres + MinIO together; **perform a real restore**; monitoring/alerts; runbooks (incident, recovery, scanner down, Redis loss).
5. **RC build:** deploy to production-like env, run migrations on empty + representative DB, smoke/regression/load.
6. Guides + UAT scripts + training seed data.

**Done when:** no critical a11y/security findings; restore demonstrated; four-party readiness sign-off.

---

## Contingency (Wk 25–30) — UAT → pilot

Treat as a **bug/defect branch flow**, not feature work:
- Triage board: `severity-1 / 2 / 3` vs `policy-question` (keep separate).
- Hotfix path: branch from RC tag → fix + regression test → re-run affected suites (security, workflow, report, file).
- Cutover checklist: prod config, secrets, branding assets, baseline data, backups, monitoring, rollback rehearsal.
- Exit: stable observation window, go/no-go decision recorded.

---

## Definition of Done (copy into PR template)

- [ ] Migration included, reversible/recovery note, runs on empty + populated DB
- [ ] Input validated with shared schema; safe errors only
- [ ] Authorization enforced server-side incl. negative tests
- [ ] State change is atomic with timeline + audit + outbox (if applicable)
- [ ] Optimistic concurrency where entity is editable
- [ ] Unit + integration + API tests added; critical path has E2E
- [ ] Structured logs/correlation ID present; no secrets/PII in logs
- [ ] UI has loading/empty/error/success states + keyboard access
- [ ] CI green (lint, types, tests, build, migration check)
