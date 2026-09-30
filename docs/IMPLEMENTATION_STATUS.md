# Implementation status & build backlog

_Last audited: 2026-09-30._

This document is both a **status report** (what is real today) and a **working backlog**
(what to build next), sized for short daily sessions.

## How to use this backlog

- Each `- [ ]` box is scoped to roughly **one ~2-hour session**. Tick it when the _Done-when_
  check passes.
- Within every module the task order is fixed and vertical:
  **Backend → Frontend → Connections → Test → Audit/verify.** Work a module top to bottom.
- Modules are dependency-ordered. **Do Slice 0 first** — it establishes the persistence
  pattern everything else reuses. After that, M1–M5 can interleave; **M6 is continuous**
  (pick from it whenever a slice reaches "verify").
- A box that spills past one session is a sign it should be split — split it.
- At ~2 h/day, 5 days/week, the ~70 boxes below are roughly a **6–8 month horizon** (about
  the 24–30 week program the spec describes, re-expressed as free-time increments).

> **A note on the two specs.** `docs/Document-management-tracking-system.md` (30 weeks) and
> `docs/CONTEXT.md` (25 weeks) both number phases 0–7, but the numbers collide and mean
> different things (e.g. "Phase 3 / Weeks 10–13" is _backend workflow_ in one and _frontend
> UI_ in the other). This backlog therefore organizes by **module + theme**, not by phase
> number, to stay unambiguous.

---

## Current reality (audited)

The old in-process, `Map`-backed application (`DtsApplicationService`) has been **retired**. Phases
0–6 are backend-complete and persisted to Postgres:

- **Identity & org** — `UsersRepository`, `AuthService`/`AuthGuard`, plus the `organization` module
  (`DivisionsRepository`/`SectionsRepository` + service + controller), the `identity` module
  (account-request submit/approve, users, profile photos), and `admin.controller.ts`.
- **Document registry** — the aggregate in `modules/documents/` (create with atomic
  tracking/reference allocation, SQL search with authorization predicates, metadata edit with
  revision history, workflow transitions, assignments, routing, sharing, work queue), with
  row-level optimistic concurrency (`WHERE version = ?`) and `workflow_events`/`audit_events`/
  `outbox_events` written in one transaction.
- **Files** — `file_records`/`file_versions` + `signature_events`/`release_events` persisted, behind
  a `StoragePort`; download fails closed unless the version is `CLEAN`.
- **Notifications & outbox** — durable inbox (`NotificationsRepository`), transactional `OutboxWriter`,
  and a BullMQ relay + worker draining the outbox (tested against real Redis).
- **Reports & audit** — monthly report + XLSX/PDF export read scoped Postgres documents;
  `audit_events` are persisted and queryable via `GET admin/audit-events` (actor/action/date filters).

**Still on stand-ins:** there is **no realtime WS/SSE gateway**. Otherwise the runtime is wired:
`docker-compose.yml` defines postgres, redis, minio (built from source), and clamav; the app writes
attachment bytes to **MinIO** through the `StoragePort`, and the worker **auto-scans** each upload
through **ClamAV** and records the verdict. The **frontend is essentially unbuilt** (`apps/web/src`
has only `dts-app.tsx` + `status-badge.tsx`).

### Module verdict

| Module                | Today                                    | Gap to pilot                                                        |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| workflow              | **DONE** (pure FSM, tested)              | Persist transitions to `workflow_events`; transactional version bump |
| authorization         | **DONE** (pure RBAC/scope, tested)       | Enforce over _persisted_ users/divisions/sections                   |
| auth / session        | **DONE** (Postgres users, JWT + bcrypt)  | —                                                                   |
| documents / search    | **Postgres-backed** (Phase 2–3)          | Remaining: soft-delete/restore endpoint, `EXPLAIN` indexes, documents UI |
| files / versions      | **Postgres metadata + MinIO storage + ClamAV auto-scan** (Phase 4) | Remaining: files UI                         |
| notifications         | **Postgres in-tx + outbox relay/worker** (Phase 5) | Remaining: realtime WS fan-out, inbox UI                |
| reports / print       | **Postgres data + real XLSX/PDF** (Phase 6) | Remaining: reports & audit UI                                    |
| admin / identity / org| **DONE** (account requests, org CRUD, roles, audit query, profile photos) | Remaining: admin & org UI          |

### Infrastructure verdict

| Capability                     | Defined in code                                        | Connected to running app? |
| ------------------------------ | ------------------------------------------------------ | ------------------------- |
| Postgres + Drizzle             | Full schema (19 tables/7 enums), client, migration, seed | **Yes for identity + documents** — `DatabaseModule` provides the `DATABASE` token; identity and the document aggregate read/write Postgres. Attachment bytes/notifications not yet migrated |
| Object storage (MinIO/S3)      | `StoragePort` + `MinioStorageAdapter` + `objectKey` columns | **Yes** — the running app writes bytes to MinIO (`minio` SDK); tests override the port with the in-memory adapter. _(Local caveat: the currently-running compose container is the license-gated AIStor image and denies S3 — `docker compose up --build` picks up the vendored AGPL build.)_ |
| BullMQ / Redis                 | `outbox-queue.ts` (queue + worker factories)           | **Yes** — the worker runs a relay + BullMQ consumer against Redis; tested in CI's integration job |
| Transactional outbox           | `outbox_events` + `OutboxWriter` + `OutboxRelay`       | **Writer + relay** — use cases enqueue in-tx; the relay leases (`FOR UPDATE SKIP LOCKED`) → BullMQ → mark published. Consumer's realtime fan-out deferred |
| Antivirus scan                 | `ClamAvScanner` (INSTREAM) + scan consumer + `POST …/scan` override | **Yes** — the worker scans each upload via clamd and records the verdict; manual endpoint remains for re-scans |
| WebSockets                     | Dependencies declared                                  | **No** — no gateway/module |
| Rate limiting                  | `ThrottlerModule`                                      | **Partial** — enforced on auth + account-request endpoints; not yet on all mutations |
| Config validation              | `config/environment.ts` + `ConfigModule.forRoot`        | **Yes** — validated at boot, fails fast |
| Structured logging + correlation IDs | `StructuredLogger`, `CorrelationIdMiddleware`     | **Yes** — global logger + per-request IDs |
| JWT auth                       | `JwtModule` + `AuthGuard`                              | **Yes** (stateless)       |
| PDF / XLSX export              | `ReportExportService` (`pdfkit`, `fflate`)             | **Yes** (real bytes)      |

---

## Slice 0 · Persistence spine _(do this first)_

Prove the Postgres pattern end-to-end on the smallest aggregate (users → login, which already
has UI). Everything after this reuses the module + repository shape you establish here.

**Backend**

- [x] (2h) Add a global `ConfigModule` (`@nestjs/config`) that validates `DATABASE_URL`, JWT
      secret, and cookie settings at boot. _Done-when:_ a missing `DATABASE_URL` fails fast with a
      clear error instead of a late crash.
- [x] (2h) Create a `DatabaseModule` that provides the Drizzle instance from
      `apps/api/src/database/client.ts` (`createDatabase`) as an injectable token; import it into
      `app.module.ts`. _Done-when:_ the `db` token injects and the app still boots.
- [x] (2h) Write a `UsersRepository` (find-by-email, find-by-id) over the `users` table.
      _Done-when:_ it returns typed rows from Postgres in a unit test.
- [x] (2h) Rewire `auth` (`authenticate`, `getUser`) and `AuthGuard`'s user lookup to
      `UsersRepository` instead of the `#users` Map; keep bcrypt + JWT. _Done-when:_ login and
      `GET /auth/me` work against a seeded Postgres.

**Connections**

- [x] (2h) Bring up Postgres from `docker-compose.yml` (postgres/redis/minio/clamav all defined),
      copy `.env.example` → `.env`, run `db:migrate` then `db:seed`. _Done-when:_ `docker compose up db`
      + migrate + seed + app login all pass locally.
- [x] (2h) Make `GET /health/ready` actually probe the DB (`SELECT 1`) and fail when it is down.
      _Done-when:_ readiness flips unhealthy when Postgres is stopped.

**Test**

- [x] (2h) Add the first DB-backed integration test (login against real Postgres) and a Postgres
      service to CI. _Done-when:_ CI provisions Postgres and the test is green. ✓ — CI's `integration
      (postgres)` job provisions postgres + redis.

**Audit / verify**

- [ ] (2h) Reconcile the three `seed.ts` users with the capabilities/divisions the app expects,
      and delete the in-memory user seed from the `DtsApplicationService` constructor. _Done-when:_
      no user state remains in any `Map` and the authorization tests still pass.

---

## Slice 0.1 · Source-alignment documents _(not started — writing task)_

Deliverables from Phase 0 of the _DTS Developer Assignment — Vertical Slices by Phase_ brief (held
outside the repo). These are **documents, not code** — deliberately left unwritten so they can be
authored in a dedicated session. The decision register (D-1–D-151), MVP boundary, and policy gates
they draw on already exist in `docs/CONTEXT.md` and `docs/policy-register.md`.

- [ ] (2h) **Traceability matrix** — map all 75 user stories → decisions D-1–D-151 → MVP or deferred
      scope → implementation area → test. _Done-when:_ every story has a decision, a scope verdict,
      and either a test or an explicit deferral.
- [ ] (2h) **Initial acceptance scenarios** — one representative incoming→archive journey plus the
      outgoing release path, written as given/when/then. _Done-when:_ both journeys are executable as
      written by someone who has not read the code.
- [ ] (2h) **Risk register** — delivery, policy, and infrastructure risks with likelihood, impact,
      owner, and mitigation. Seed it from the unresolved items in `docs/CONTEXT.md`. _Done-when:_
      every unresolved policy question appears as a risk with a named owner.

> **Gate (blocked, not deferred):** Phase 0 of the assignment treats these three documents as a
> sign-off gate for the whole programme. It cannot be signed off from the repository alone — the
> risk register needs an owner per risk, and the policy questions need a decision from the records
> office. Track it as blocked on those inputs rather than as remaining engineering work.

---

## M1 · Identity, access & organization

Depends on Slice 0's `UsersRepository`.

**Backend**

- [x] (2h) `DivisionsRepository` + `SectionsRepository` over `divisions`/`sections`; remove the
      hard-coded `division-*` / `section-*` heuristics in `createDocument`. _Done-when:_ org units
      resolve from Postgres. ✓ (`organization` module)
- [x] (2h) Account-request submission: `POST /auth/account-requests` (unauthenticated) writing a
      `PENDING` row to `account_requests`. _Done-when:_ a request row persists. ✓ (`identity/account-requests.controller.ts`)
- [x] (2h) Account-request approve/reject (capability-gated) that creates a `users` row on approve.
      _Done-when:_ an approved request yields a login-capable account. ✓
- [x] (2h) Org admin endpoints: create/deactivate user, assign role, create division/section
      (the `GET /users` list already exists). _Done-when:_ an admin can manage the org over the API. ✓ (`admin.controller.ts`)

**Frontend**

- [ ] (2h) "Request an account" screen on the login page wired to the account-request endpoint.
      _Done-when:_ an unauthenticated visitor can submit a request.
- [ ] (2h) Admin console page: pending-request queue with approve/reject. _Done-when:_ an admin
      approves a request from the UI.
- [ ] (2h) Admin console: user table + role assignment + division/section management.
      _Done-when:_ the org is manageable from the UI.

**Connections**

- [x] (2h) Seed real divisions/sections/roles; confirm the app no longer depends on any in-memory
      identity. _Done-when:_ identity is fully Postgres-backed end to end. ✓

**Test**

- [ ] (2h) Integration tests: request → approve → login, plus authz (a non-admin cannot approve).
      _Done-when:_ green in CI against Postgres.

**Audit / verify**

- [ ] (2h) Confirm every new endpoint enforces capability + scope, and that approvals/role changes
      write to `audit_events`. _Done-when:_ privileged actions appear in the audit trail.

---

## M2 · Documents, metadata & workflow persistence

The workflow FSM and search logic are already correct and tested — this module gives them durable
storage and fills the document-management UI gaps.

**Backend**

- [x] (2h) `DocumentsRepository` + atomic tracking/reference-number issue (`reference_counters`
      for outgoing refs per division/year; `document_sequences` for office-wide tracking) inside a
      transaction. _Done-when:_ numbers are unique under concurrent creation. ✓ (12-parallel int test)
- [x] (2h) Persist transitions atomically: `documents` update (optimistic `version`) + `workflow_events`
      row + `audit_events` + `outbox_events` in **one** transaction. _Done-when:_ `executeAction` is
      durable and all-or-nothing.
- [x] (2h) Metadata edit: `PATCH /documents/:id/metadata` recording before/after in
      `document_metadata_revisions`, under optimistic concurrency. _Done-when:_ edits are captured as history.
- [x] (2h) Persist assignments (`document_assignments`), routing/forwarding (`document_routes`,
      `POST /documents/:id/routes`) and sharing (`document_shares`, `POST /documents/:id/shares`),
      plus the work queue (`GET /documents/assigned`). _(Phase 3; parallel-route completion
      semantics deferred as an open policy.)_
- [x] (2h) Logical deletion (soft-delete) endpoint + list exclusion, capability-gated. ✓ —
      `DELETE /documents/:id` and `POST /documents/:id/restore` under optimistic concurrency, gated by
      the new `DOCUMENT_DELETE` / existing `DOCUMENT_RESTORE` capabilities (admin-only); both audited
      and enqueued to the outbox. Covered by the Postgres integration flow.
- [x] (2h) Move `DocumentSearchService` filtering/sort/pagination to SQL (`DocumentsRepository.search`
      + `documentScopeFor`). _Done-when:_ search has parity with the in-memory version plus real pagination.

**Frontend**

- [ ] (2h) List controls: filters (status/priority/type/direction/division/section), sort, and
      pagination. _Done-when:_ controls drive the server query (no more hard-coded `pageSize=50`).
- [ ] (2h) Metadata edit UI with a revision-history view. _Done-when:_ a user edits metadata and
      sees the history.
- [ ] (2h) Routing/forwarding UI in the detail panel. _Done-when:_ a document can be forwarded to a
      section/user from the UI.
- [ ] (2h) Logical deletion + restore UI, guarded by capability. _Done-when:_ delete/restore works
      from the UI.

**Connections**

- [x] (2h) Enforce optimistic concurrency at the row level (`WHERE version = ?`), not in a Map.
      _Done-when:_ a stale action returns 409 from the database layer. ✓ (`documents.repository.ts`,
      `eq(documents.version, expectedVersion)` guards)

**Test**

- [ ] (2h) Integration flow: create → edit → route → workflow → delete over Postgres, plus a
      concurrency-conflict case. _Done-when:_ green in CI.

**Audit / verify**

- [ ] (2h) Confirm every mutation writes a timeline + audit row and that cross-division reads are
      impossible. _Done-when:_ audit coverage complete, no scope leakage.

---

## M3 · Files, object storage & malware scanning

The upload policy (media allow-list, 25 MB limit, magic-byte sniffing, fail-closed download, IDOR
guard) is already implemented against a `Map` — this module puts real storage and a real scanner
behind it.

**Backend**

- [x] (2h) Introduce a storage abstraction with server-generated keys and no overwrite, plus the
      real MinIO/S3 adapter. **Done** — `StoragePort` + `MinioStorageAdapter` (`minio-storage.adapter.ts`,
      bucket auto-create, `put` refuses overwrite via `statObject`); the running app binds MinIO while
      unit/integration suites override the port with the in-memory adapter. ✓
- [x] (2h) Persist `file_records` + `file_versions` to Postgres with immutability enforced
      (`file-versions.repository.ts`; unique `(file_record_id, version_number)`, scan-status the only
      mutable field). _Done-when:_ versions are durable and cannot be mutated. ✓
- [x] (2h) Persist `signature_events` + `release_events`; the clean-and-signed outgoing-release
      invariant is evaluated from the persisted version + document row. ✓
- [x] (2h) Download fails closed unless the version's scan is `CLEAN` — **done**; bytes are now
      served from MinIO through the `StoragePort`. _(Presigned-URL streaming is a later optional
      optimization; the current path reads through the API.)_

**Frontend**

- [ ] (2h) File-upload input in the register modal and detail panel (multipart to the attachments
      endpoint). _Done-when:_ a user uploads a file.
- [ ] (2h) Version-history list with per-version scan-status badges. _Done-when:_ versions and their
      scan state are visible.
- [ ] (2h) Download/preview control gated by scan state. _Done-when:_ clean files download; others
      are blocked with a clear reason.

**Connections**

- [x] (2h) Add MinIO + ClamAV services to `docker-compose.yml` and wire their env vars. _Done-when:_
      both run locally alongside the app. ✓ (minio built from source + clamav services defined; the
      app's MinIO adapter binding is the remaining backend piece above)
- [x] (2h) Scan pipeline: the worker consumes an upload event, runs ClamAV, and records the result
      (the manual `POST …/scan` stays as an override). _Done-when:_ uploads auto-transition to
      CLEAN/INFECTED. ✓ — `upload` enqueues an `attachment.uploaded` outbox event; the worker's
      `scanUploadedVersion` streams the bytes to clamd (`ClamAvScanner`, INSTREAM) and records the
      verdict. Scanner verified against live clamd (EICAR→INFECTED, benign→CLEAN). _(Auto-scan
      integration test with EICAR-in-CI remains under the M3 Test box.)_

**Test**

- [ ] (2h) Integration: upload → auto-scan → download, including an EICAR test file that must stay
      blocked as INFECTED. _Done-when:_ fail-closed proven against the real scanner.

**Audit / verify**

- [ ] (2h) Re-verify allow-list, size limit, untrusted-filename handling, and the IDOR guard against
      the MinIO-backed paths. _Done-when:_ all file-security checks pass on real storage.

---

## M4 · Notifications, outbox & realtime

Notifications are computed and unit-tested but discarded by the UI and stored in a `Map`. This
module makes them durable, event-driven, and live.

**Backend**

- [x] (2h) Persist notifications to the `notifications` table (`NotificationsRepository`), written in
      the domain transaction. _Done-when:_ notifications survive a restart. ✓
- [x] (2h) Transactional outbox: domain mutations enqueue `outbox_events` in the _same_ transaction
      (`OutboxWriter`, since Phase 2). ✓
- [x] (2h) BullMQ relay + worker in `worker.ts`: `OutboxRelay` leases `outbox_events` → queue → the
      worker consumes. _Done-when:_ the relay drains the outbox onto the queue and a worker consumes it
      (tested against real Redis). ✓ — the consumer's realtime fan-out is the deferred piece.
- [ ] (2h) Authenticated WebSocket/SSE gateway for realtime delivery. **Deferred**; the durable inbox
      + relay/worker are in place, and the consumer is the plug-in point.

**Frontend**

- [ ] (2h) Notifications inbox: render the fetched list (stop discarding it), with relative times
      and unread styling. _Done-when:_ the inbox shows items.
- [ ] (2h) Mark-as-read (single + all) wired to the endpoint; the badge updates. _Done-when:_ read
      state persists and the badge decrements.
- [ ] (2h) Live updates over WS/SSE with reconnect + catch-up on focus. _Done-when:_ a new
      notification appears without a refresh.

**Connections**

- [x] (2h) Add Redis to `docker-compose.yml`, wire the BullMQ connection, and run the worker via
      `start:worker`. _Done-when:_ outbox → queue → push works end to end locally. ✓ (redis + worker
      services defined; relay/worker tested against real Redis in CI)

**Test**

- [ ] (2h) Tests: outbox delivered exactly once; realtime reconnect/catch-up. _Done-when:_ green.

**Audit / verify**

- [ ] (2h) Confirm notifications are scope-correct (no cross-division leakage) and the WS handshake
      is authenticated. _Done-when:_ verified.

---

## M5 · Reports, audit trail & print

**Backend**

- [x] (2h) Persist `audit_events` to Postgres and add a query endpoint with filters
      (actor/date/outcome). _Done-when:_ the audit log is durable and filterable. ✓ (`audit.writer.ts`
      + `GET admin/audit-events`)
- [x] (2h) Compute the monthly report and routing slip from Postgres data. _Done-when:_ reports read
      persisted documents. ✓ (`monthly-report.service.ts` over scoped Postgres documents)

**Frontend**

- [ ] (2h) Reports page: month picker, on-screen view, and XLSX/PDF download (endpoints already
      exist). _Done-when:_ reports are usable from the UI.
- [ ] (2h) Routing-slip download from the document detail panel. _Done-when:_ the slip downloads.
- [ ] (2h) Audit-trail viewer page with filters. _Done-when:_ the audit log is browsable.
- [ ] (2h) Dashboard richness: pending-by-division, overdue highlighting, recent-activity feed.
      _Done-when:_ the richer metrics render.

**Test**

- [ ] (2h) Tests: report math over seeded Postgres, audit-filter correctness, and the
      spreadsheet-injection guard (`sanitizeSpreadsheetCell`). _Done-when:_ green.

**Audit / verify**

- [ ] (2h) Confirm report/audit access is gated by `REPORT_VIEW` / `AUDIT_VIEW`. _Done-when:_
      unauthorized callers are blocked.

---

## M6 · Hardening & pilot evidence _(continuous)_

Pull from this list whenever a slice above reaches "verify."

**Backend / infra**

- [~] (2h) `ConfigModule` env validation across all services + `ThrottlerModule` rate limiting on
      auth and mutations. _Partial:_ env validated at boot; throttler enforced on auth + account-request
      endpoints. _Remaining:_ extend rate limits to the mutation endpoints.
- [x] (2h) Readiness probes every critical dependency, split by process so each probes its own
      request path: the API's `GET /health/ready` (and `/ready`) probes **Postgres + object storage**,
      and the worker's `/ready` probes **Postgres + Redis**. Each probe runs under a 2s timeout and
      fails closed (503) with a safe envelope. ✓

**Test / evidence**

- [ ] (2h) Postgres + MinIO integration harness (compose or testcontainers) running in CI.
      _Done-when:_ CI spins up the real dependencies.
- [ ] (2h) Playwright E2E: login → register document → upload → workflow → release. _Done-when:_
      the E2E flow is green in CI.
- [ ] (2h) Accessibility automation (axe) on the key screens. _Done-when:_ no critical violations.
- [ ] (2h) Security tests: authorization matrix, IDOR, upload abuse, rate limits. _Done-when:_ the
      suite is green.
- [ ] (2h) Representative-load test (search + upload + workflow). _Done-when:_ latency/throughput
      are recorded against a target.
- [ ] (2h) Backup/restore rehearsal for coordinated Postgres + MinIO using `scripts/backup.sh` and
      `scripts/restore.sh`. _Done-when:_ a restore is verified against a checklist.

**Audit / policy**

- [ ] (2h) Resolve the open policy decisions — records policy, branding, reference format, SLA
      calendar, signature meaning, file allow-list/limits, retention — and encode each (no
      hard-coded placeholder heuristics). _Done-when:_ every decision is made and reflected in code.
- [ ] (2h) Configure audit retention (currently preserve-by-default, dev only, no purge).
      _Done-when:_ retention matches the agreed policy.

---

_No unresolved policy is encoded as permanent behavior. Audit retention remains preserve-by-default
for development only, with no automated purge, until the M6 policy box above is resolved._
