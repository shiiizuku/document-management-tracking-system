# DTS — Coding Breakdown by Phase

Companion to `dts-developer-assignment.md`. This version is written the way a developer works: **repo layout → schema → endpoints → task order → tests → PR slices → done-when.**

> Names below (folders, tables, files) are **suggested conventions** derived from the plan's module boundaries, ER model, and endpoint list. Adjust to repo standards, but keep the module boundaries (Identity, Authorization, Organization, Documents, Workflow, Routing, Files, Notifications, Reports, Audit, Outbox/Jobs).

---

## Phase status (updated 2026-09-29)

| Phase                              | Backend            | Frontend      | Notes                                                                 |
| ---------------------------------- | ------------------ | ------------- | --------------------------------------------------------------------- |
| 0 — Foundations                    | ✅ done            | n/a           | Cold-boot + IT sign-off are external gates (see `policy-register.md`) |
| 1 — Identity & Organization        | ✅ done            | ⏳ deferred   | Merged in PR #39; frontend intentionally deferred                      |
| 2 — Document registry              | ✅ done            | ⏳ deferred   | Aggregate is Postgres-backed, `DtsApplicationService` retired (PR #40) |
| 3 — Workflow & routing             | ◑ mostly done      | ⏳ deferred   | Transitions, assignment, routing/forwarding, sharing, work queue persisted (PR #41); parallel-route completion semantics deferred (open policy) |
| 4 — Files & scanning               | ◑ persistence done | ⬜ not started | `file_records`/`file_versions` + `signature_events` persisted; bytes behind a `StoragePort` (in-memory adapter); MinIO adapter + ClamAV scan worker deferred (need running services) |
| 5 — Outbox, notifications, dashboard | ◑ mostly done    | ⬜ not started | Notifications persisted in the domain tx; outbox **relay + BullMQ worker** run against real Redis; dashboard summary scoped. Realtime WS gateway deferred |
| 6 — Reports, routing slip, audit UI | ✅ done            | ⏳ deferred   | Monthly report (JSON/PDF/XLSX), routing-slip PDF, and audit query (`user`/`action`/`from`/`to` + pagination) all Postgres-backed and audited; every export logged (`feat/phase-6-reports-audit`). UI deferred |
| 7 — Hardening & readiness          | ⬜ not started     | ⬜ not started |                                                                       |

Legend: ✅ done · ◑ partial · ⏳ deferred (planned for a later phase) · ⬜ not started. **Frontend is
deferred across the board** by an explicit decision (`docs/phase-1-completion-report.md`); the
backend is being driven to durability first, with the UI to follow.

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

> A phase receives a ⭐ only after every task, required test, and completion criterion is verified.

**Goal:** a repo where a new machine runs the whole stack, CI is green, and schema/ops conventions exist before any feature.

**Tasks (in order)**
- [x] Init monorepo, TS configs, lint/format, commit hooks.
- [x] `docker-compose.yml`: postgres, redis, minio, scanner, api, worker, web; health checks; named volumes.
- [x] Env validation module (fail fast on missing/invalid config).
- [x] Drizzle setup: migration runner, `id` (uuid) / `created_at` / `updated_at` / `version` base helpers.
- [x] Core tables: `audit_event`, `outbox_event`.
- [x] Common infra: correlation-ID middleware, structured logger, global exception filter (safe envelope), `/health` + `/ready`.
- [x] CI: lint → typecheck → unit → integration (Postgres service) → build.
- [x] Docs: ADRs (modular monolith, session transport, ID strategy), deployment decision record, policy register.

**Tests**

- [x] Health endpoint smoke test.
- [x] Migration up on an empty database test.
- [x] Environment validation failure test.

**PR slices:** `chore/repo-scaffold` · `chore/compose-stack` · `feat/db-conventions` · `feat/observability-baseline` · `chore/ci-pipeline`

**Done when:**

- [ ] Clean machine → `docker compose up` → healthy stack. *(Compose config validates and every service declares a health gate; an end-to-end cold boot on a clean machine has not been run.)*
- [x] CI green.
- [ ] No infrastructure blocker from IT. *(External sign-off; see P-13 in `policy-register.md`.)*

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

> **Status (2026-09-29): backend slices complete.** The document aggregate is now Postgres-backed
> (`modules/documents/documents.repository.ts` + `documents.service.ts`), replacing the in-memory
> `DtsApplicationService`, which has been retired. Create (with atomic tracking + outgoing-reference
> allocation), list/search with authorization predicates in SQL, metadata edit with optimistic
> concurrency + revision history, and — carried along to keep the running app coherent — workflow
> transitions, assignment, and the attachment→document link are all durable. Attachment bytes/version
> metadata stay in an in-memory `AttachmentStore` until Phase 4 (Files & scanning); notification and
> report *reads* now come from Postgres, but their own persistence lands in Phases 5–6.
> **Frontend is deferred to a later phase** (consistent with the Phase 1 frontend deferral), so this
> was a backend + tests increment rather than a full vertical slice. Covered by
> `test/documents.int.test.ts` against real Postgres in CI.

**Schema**
- `document (direction, title, type, description, priority, sender, company, external_ref, reference_number UNIQUE, workflow_status, owner_division_id, version, deleted_at)`
- `document_metadata_revision`, `workflow_event`, `reference_counter (division_id, scope_key, next_value)`

**Endpoints**
```
POST  /documents            GET /documents            GET /documents/{id}
PATCH /documents/{id}/metadata      (If-Match / version)
```

**Backend tasks**
1. [x] Document create use case (incoming keeps external ref; outgoing allocates reference).
2. [x] **Reference allocation:** atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` on `reference_counters` inside the create transaction (per division + year); tracking numbers from a separate office-wide `document_sequences` counter.
3. [x] Metadata edit with optimistic version check → writes `document_metadata_revisions` + audit.
4. [x] List query: limit/offset pagination, deterministic sort (sort key + `id` tiebreak), filters (status, priority, type, direction, division, section), search on title/tracking/reference/sender/company — **authorization predicates in the SQL** (`documentScopeFor`), never post-filtered in app memory.
5. [ ] Add indexes only after `EXPLAIN` on seeded representative data (B-tree, trigram if measured). _(Deferred to the Phase 6/hardening EXPLAIN pass; the scope/sort indexes from Phase 0 already back these queries.)_

**Frontend tasks**
- Create form (incoming/outgoing variants), detail page + timeline, edit metadata with conflict UX, list with filters/sort/pagination/search.

**Tests**
- [x] Concurrency: N parallel outgoing creates → N unique references. _(`documents.int.test.ts`, 12 parallel.)_
- [x] Conflict: two edits → second gets 409. _(Also a stale workflow action → 409.)_
- [x] Search/filter authorization; pagination stability. _(Cross-scope doc excluded from a staff member's totals; the pure `document-search` unit suite covers boundary inputs and sort/pagination.)_

**PR slices:** `feat/document-create` · `feat/reference-allocation` · `feat/metadata-edit-history` · `feat/document-list-search` _(delivered together on `feat/phase-2-document-registry`, backend-only per the frontend deferral.)_

**Done when:** records staff can register + retrieve; no duplicate refs; counts and results respect scope. — **met** (backend + integration tests; frontend deferred).

---

## Phase 3 — Workflow & routing (Wk 10–13)

**Goal:** full predefined workflow enforced by the server, with assignments and multi-division routing.

> **Status (2026-09-29): backend mostly done.** The workflow FSM (transition table + guards),
> `allowed-actions`, and the persisted transitions/assignment landed with Phase 2 (brought forward
> for coherence). This branch adds **routing/forwarding** (`POST /documents/:id/routes` — moves the
> document's owning division/section and records the hop in `document_routes`, under optimistic
> concurrency), **sharing** (`POST /documents/:id/shares` — grants one user read access via
> `document_shares`), and the **work queue** (`GET /documents/assigned`). Deferred: **parallel routes +
> completion semantics** (an open policy question — "per agreement" below), and **`signature_events`**
> rows, which FK to `file_versions` and therefore wait for Phase 4 (SIGN already records the signed
> version on the document row via `signedFileVersionId`). Frontend deferred.

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
1. [x] **Transition table as data:** `{ from, action, to }` in `WorkflowService`; it is the only decider, and `DocumentsService.executeAction` the only writer of `workflow_status`.
2. [~] Guards live inside `WorkflowService.execute` (remark-required, clean+signed-attachment, release-method); extracting them into individually named pure functions is a tidy-up, not yet done.
3. [x] `allowed-actions` = filter the table by actor capability + state (VIEWER excluded).
4. [x] Assignment + section routing (`POST /documents/:id/routes`, downward move) + work-queue query (`GET /documents/assigned`).
5. [~] Routing records `document_routes` and blocks the no-op self-route; **parallel routes + completion semantics deferred** (open policy — see "per agreement").
6. [x] Release records method in `release_events`; archive/restore work; **`signature_events` now persisted** (Phase 4 landed `file_versions`), and SIGN records `signedFileVersionId` on the row.
7. [x] Return-for-revision requires a remark (validated in `WorkflowService`).

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

> **Status (2026-09-29): persistence + storage seam done; scanner infra deferred.** Attachment
> metadata now lives in Postgres (`file_records` + `file_versions`, one version immutable except its
> `scan_status`), and bytes live behind a `StoragePort` whose current binding is an in-memory adapter
> (server-generated quarantine keys, no overwrite) — a MinIO/S3 adapter drops in without touching the
> use cases. Upload sniffs the real media type, enforces the size limit, and quarantines as PENDING;
> download **fails closed** until CLEAN; a final scan result is immutable; the IDOR guard is a SQL
> join. `signature_events` are now persisted (closing the Phase 3 deferral). **Deferred:** the MinIO
> adapter, the ClamAV **scan worker** (BullMQ/Redis) — the manual `POST …/scan` endpoint stands in for
> it — and short-lived/presigned download. These need running services the sandbox can't host and are
> best landed with the infra they target. Frontend deferred.

**Schema**
- `file_record (document_id)`, `file_version (file_record_id, version_number, object_key, checksum, size, mime, scan_status)`, `file_scan (file_version_id, result, attempts, scanned_at)`; unique `(file_record_id, version_number)`.

**Endpoints**
```
POST /documents/{id}/files            POST /files/{id}/versions
GET  /files/{id}/versions/{vid}/content
```

**Backend tasks**
1. [~] Storage port (`put`/`get`, no overwrite, server-generated keys) — **done** with an in-memory adapter; **MinIO adapter deferred**.
2. [~] Upload use case: authorize → size/type limits at ingress → insert `PENDING` version → store bytes under the quarantine key → checksum. **Done**; enqueue-scan-via-outbox lands with the worker.
3. [ ] Scan worker: stream to scanner, set `CLEAN`/`INFECTED`/`SCAN_FAILED`; bounded retries; **fail closed**. **Deferred** (needs ClamAV + Redis); the manual `POST …/scan` endpoint stands in, and download already fails closed.
4. [~] Content endpoint: authorize → require `CLEAN` → `nosniff` + attachment disposition. **Done** (in-memory bytes); short-lived/presigned access lands with MinIO.
5. [x] Release guard: outgoing needs its current attachment CLEAN **and** signed — enforced from the persisted version + document row.

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

> **Status (2026-09-29): durable pipeline + dashboard done; realtime deferred.** Notification rows
> are written in the **same transaction** as the domain change (`NotificationsRepository.insert` inside
> the assignment tx), so a notification can't be lost to a downed worker. The **outbox relay**
> (`modules/jobs/outbox-relay.ts`) leases unpublished `outbox_events` with `FOR UPDATE SKIP LOCKED`,
> enqueues an idempotent **BullMQ** job (jobId = outbox row id) and marks them published; the **worker**
> (`worker.ts`) runs the relay on an interval and a BullMQ `Worker` consumes the queue. This is tested
> against a **real Redis** (run natively; a `redis` service added to the CI integration job). The
> **dashboard summary** (`GET /dashboard/summary`) reuses `documentScopeFor`. **Deferred:** the realtime
> WS/SSE gateway (task 4) — the consumer is the seam where it plugs in — and per-recipient email; the
> durable inbox works without them. Frontend deferred.

**Schema**
- `notification (user_id, type, document_id, read_at, seq)`; outbox columns: `status`, `lease_until`, `attempts`, `idempotency_key`.

**Endpoints**
```
GET  /notifications?cursor=      POST /notifications/{id}/read
GET  /dashboard/summary          (+ realtime channel)
```

**Backend tasks**
1. [x] **Outbox publisher:** lease unpublished rows (`FOR UPDATE SKIP LOCKED`) → enqueue idempotent BullMQ job → mark published, all in one transaction.
2. [x] Job conventions: queue name, typed payload, idempotency (jobId = outbox row id), bounded retries + exponential backoff, failures kept for inspection.
3. [~] Notification rows written in the domain transaction; audience resolver currently covers assignment (assignee). Route/workflow audiences are easy follow-ons.
4. [ ] Realtime gateway (authenticated subscribe, authorized fan-out, catch-up) — **deferred**; the queue consumer is the plug-in point.
5. [x] Dashboard summary reuses the scoped list predicate (`documentScopeFor`) — one source of truth for scope.

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

> **Status (2026-09-29): backend done.** Monthly reports (JSON / PDF / XLSX) and the routing-slip
> PDF were delivered earlier and are scope-aware; spreadsheet cells starting with `= + - @` are
> sanitised against formula injection. This branch (`feat/phase-6-reports-audit`) closed the two
> remaining gaps: the **audit query API** now takes the documented `user` / `action` / `from` / `to`
> filters plus `limit`/`offset` pagination (ISO dates validated, malformed → `400`; backed by the
> existing `(actor, action, occurred_at)` index, no migration), and **every file export is now its
> own audit event** — `report.exported` (`{ format, year, month }`) for the PDF/XLSX and
> `document.routing-slip-exported` for the slip, IDs/format only, distinct from the on-screen
> `report.monthly-viewed`. Verified against real Postgres + Redis in Docker; see
> `docs/phase-6-completion-report.md`. **Frontend deferred** to the UI track, per every prior phase.

**Endpoints**
```
GET /reports/monthly  |  /reports/monthly.pdf  |  /reports/monthly.xlsx
GET /documents/{id}/routing-slip.pdf
GET /audit-events?user=&action=&from=&to=
```

**Backend tasks**
1. [x] Report definition module: explicit aggregate queries (incoming/outgoing/FOI/special-order per month), scope-aware.
2. [x] PDF + XLSX generators; **sanitize cells starting with `= + - @`** (formula injection); **audit each export** (`report.exported` with format/period).
3. [x] Routing slip renderer: branding config, timeline, remarks, statuses; export audited (`document.routing-slip-exported`).
4. [x] Audit query API (insert + read only for app DB role), filters (`user`/`action`/`from`/`to`), pagination (`limit`/`offset`); restrict to auditor/admin scope.

**Frontend tasks** _(deferred to the UI track)_
- Report page (month/year filter, print view, export buttons), routing-slip print action, audit table + filters.

**Tests**
- [x] Fixture data → totals reconcile; PDF/XLSX open/validate; formula-injection payloads (`monthly-report.test.ts`).
- [x] Every export writes a distinct audit event carrying IDs/format only — no body text or party names (`api.test.ts`).
- [x] Audit query filters + pagination end-to-end over HTTP, malformed date → `400` (`identity.int.test.ts`).

**PR slices:** `feat/monthly-reports` · `feat/report-exports-safe` · `feat/routing-slip` · `feat/audit-viewer` _(delivered together on `feat/phase-6-reports-audit`, backend-only per the frontend deferral.)_

**Done when:** records staff sign off totals; routing slip approved; every critical scenario traceable in audit. — **backend met** (integration tests against real Postgres; formula-injection + export-audit + audit-query covered; frontend + records-staff sign-off deferred to the UI track).

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
