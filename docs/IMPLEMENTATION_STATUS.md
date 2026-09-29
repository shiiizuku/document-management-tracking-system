# Implementation status & build backlog

_Last audited: 2026-09-29._

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

Most of the running HTTP app is still a single **in-process, `Map`-backed** application
(`apps/api/src/modules/application/dts-application.service.ts`). Slice 0's persistence spine is now
real for **identity**: `DatabaseModule` provides the Drizzle instance as an injectable `DATABASE`
token, `UsersRepository` reads the `users` table, `AuthService`/`AuthGuard` resolve users through it,
and `GET /ready` probes Postgres with `select 1`. Everything else — documents, files, notifications,
reports — still lives in `Map`s. The BullMQ/Redis/object-storage/WebSocket dependencies exist in the
repo but are **not wired into the runtime**.

### Module verdict

| Module                | Today                                    | Gap to pilot                                                        |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| workflow              | **DONE** (pure FSM, tested)              | Persist transitions to `workflow_events`; transactional version bump |
| authorization         | **DONE** (pure RBAC/scope, tested)       | Enforce over _persisted_ users/divisions/sections                   |
| auth / session        | STUBBED (in-memory users)                | Users from Postgres; keep JWT + bcrypt                              |
| documents / search    | STUBBED (Maps)                           | Postgres repos, metadata edit + revisions, filters, routing, deletion |
| files / versions      | STUBBED (`#objectStore` Map)             | Real object storage (MinIO) + ClamAV scan pipeline; files UI        |
| notifications         | STUBBED (Map)                            | Persist + outbox/BullMQ + realtime fan-out; inbox UI                |
| reports / print       | STUBBED data / **real** XLSX+PDF bytes   | Report + audit data from Postgres; reports & audit UI               |
| admin / identity / org| STUBBED (users/audit list only)          | Account requests, org CRUD, role assignment, profile photos         |

### Infrastructure verdict

| Capability                     | Defined in code                                        | Connected to running app? |
| ------------------------------ | ------------------------------------------------------ | ------------------------- |
| Postgres + Drizzle             | Full schema (18 tables/7 enums), client, migration, seed | **Partly** — `DatabaseModule` provides the `DATABASE` token to identity + readiness; documents/files/notifications still `Map`-backed |
| Object storage (MinIO/S3)      | `objectKey` columns + key computation                  | **No** — bytes in a `Map` |
| BullMQ / Redis                 | Dependencies declared                                  | **No** — never imported   |
| Transactional outbox           | `outbox_events` table                                  | **No** — no writer/relay  |
| Antivirus scan                 | `scan_status` enum + `POST …/scan` endpoint            | **Manual only** — no scanner |
| WebSockets / rate-limit        | Dependencies declared                                  | **No** — no gateway/module |
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

- [ ] (2h) Bring up Postgres from `compose.yaml`, copy `.env.example` → `.env`, run `db:migrate`
      then `db:seed`. _Done-when:_ `docker compose up db` + migrate + seed + app login all pass locally.
- [x] (2h) Make `GET /health/ready` actually probe the DB (`SELECT 1`) and fail when it is down.
      _Done-when:_ readiness flips unhealthy when Postgres is stopped.

**Test**

- [ ] (2h) Add the first DB-backed integration test (login against real Postgres) and a Postgres
      service to CI. _Done-when:_ CI provisions Postgres and the test is green.

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

- [ ] (2h) `DivisionsRepository` + `SectionsRepository` over `divisions`/`sections`; remove the
      hard-coded `division-*` / `section-*` heuristics in `createDocument`. _Done-when:_ org units
      resolve from Postgres.
- [ ] (2h) Account-request submission: `POST /auth/account-requests` (unauthenticated) writing a
      `PENDING` row to `account_requests`. _Done-when:_ a request row persists.
- [ ] (2h) Account-request approve/reject (capability-gated) that creates a `users` row on approve.
      _Done-when:_ an approved request yields a login-capable account.
- [ ] (2h) Org admin endpoints: create/deactivate user, assign role, create division/section
      (the `GET /users` list already exists). _Done-when:_ an admin can manage the org over the API.

**Frontend**

- [ ] (2h) "Request an account" screen on the login page wired to the account-request endpoint.
      _Done-when:_ an unauthenticated visitor can submit a request.
- [ ] (2h) Admin console page: pending-request queue with approve/reject. _Done-when:_ an admin
      approves a request from the UI.
- [ ] (2h) Admin console: user table + role assignment + division/section management.
      _Done-when:_ the org is manageable from the UI.

**Connections**

- [ ] (2h) Seed real divisions/sections/roles; confirm the app no longer depends on any in-memory
      identity. _Done-when:_ identity is fully Postgres-backed end to end.

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

- [ ] (2h) `DocumentsRepository` + atomic tracking/reference-number issue via `reference_counters`
      inside a transaction. _Done-when:_ numbers are unique under concurrent creation.
- [ ] (2h) Persist transitions atomically: `documents` update + `workflow_events` row +
      `audit_events` in **one** transaction (replaces `#documents`/`#timeline`). _Done-when:_
      `executeAction` is durable and all-or-nothing.
- [ ] (2h) Metadata edit: `PATCH /documents/:id/metadata` recording before/after in
      `document_metadata_revisions`. _Done-when:_ edits are captured as history.
- [ ] (2h) Persist assignments + routing/sharing (`document_assignments`, `document_routes`,
      `document_shares`) and add a forward/route endpoint. _Done-when:_ routing persists and authz
      respects shares.
- [ ] (2h) Logical deletion (soft-delete) endpoint + list exclusion, capability-gated.
      _Done-when:_ deleted documents are hidden yet recoverable.
- [ ] (2h) Move `DocumentSearchService` filtering/sort/pagination to SQL. _Done-when:_ search has
      parity with the in-memory version plus real pagination.

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

- [ ] (2h) Enforce optimistic concurrency at the row level (`WHERE version = ?`), not in a Map.
      _Done-when:_ a stale action returns 409 from the database layer.

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

- [ ] (2h) Introduce an object-storage client (MinIO/S3 SDK) with a private bucket; replace the
      `#objectStore` Map in `uploadAttachment`/`downloadAttachment`. _Done-when:_ bytes live in
      MinIO under the server-generated `objectKey`.
- [ ] (2h) Persist `file_records` + `file_versions` to Postgres with immutability enforced.
      _Done-when:_ versions are durable and cannot be mutated.
- [ ] (2h) Persist `signature_events` + `release_events`; keep the clean-and-signed outgoing-release
      invariant, now evaluated from DB state. _Done-when:_ sign/release are recorded and the
      invariant holds.
- [ ] (2h) Streamed/presigned download that still fails closed unless the version's scan is `CLEAN`.
      _Done-when:_ pending/infected versions are never downloadable.

**Frontend**

- [ ] (2h) File-upload input in the register modal and detail panel (multipart to the attachments
      endpoint). _Done-when:_ a user uploads a file.
- [ ] (2h) Version-history list with per-version scan-status badges. _Done-when:_ versions and their
      scan state are visible.
- [ ] (2h) Download/preview control gated by scan state. _Done-when:_ clean files download; others
      are blocked with a clear reason.

**Connections**

- [ ] (2h) Add MinIO + ClamAV services to `compose.yaml` and wire their env vars. _Done-when:_ both
      run locally alongside the app.
- [ ] (2h) Scan pipeline: the worker consumes an upload event, runs ClamAV, and records the result
      (replacing the manual `POST …/scan`). _Done-when:_ uploads auto-transition to CLEAN/INFECTED.

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

- [ ] (2h) Persist notifications to the `notifications` table. _Done-when:_ notifications survive a
      restart.
- [ ] (2h) Transactional outbox writer: domain mutations enqueue `outbox_events` in the _same_
      transaction as the state change. _Done-when:_ events are recorded atomically with the change.
- [ ] (2h) Implement the BullMQ worker in `worker.ts`: relay `outbox_events` → queue → notification
      fan-out. _Done-when:_ the worker drains the outbox into notifications.
- [ ] (2h) Authenticated WebSocket/SSE gateway for realtime delivery. _Done-when:_ a connected
      client receives a pushed notification.

**Frontend**

- [ ] (2h) Notifications inbox: render the fetched list (stop discarding it), with relative times
      and unread styling. _Done-when:_ the inbox shows items.
- [ ] (2h) Mark-as-read (single + all) wired to the endpoint; the badge updates. _Done-when:_ read
      state persists and the badge decrements.
- [ ] (2h) Live updates over WS/SSE with reconnect + catch-up on focus. _Done-when:_ a new
      notification appears without a refresh.

**Connections**

- [ ] (2h) Add Redis to `compose.yaml`, wire the BullMQ connection, and run the worker via
      `start:worker`. _Done-when:_ outbox → queue → push works end to end locally.

**Test**

- [ ] (2h) Tests: outbox delivered exactly once; realtime reconnect/catch-up. _Done-when:_ green.

**Audit / verify**

- [ ] (2h) Confirm notifications are scope-correct (no cross-division leakage) and the WS handshake
      is authenticated. _Done-when:_ verified.

---

## M5 · Reports, audit trail & print

**Backend**

- [ ] (2h) Persist `audit_events` to Postgres and add a query endpoint with filters
      (actor/date/outcome). _Done-when:_ the audit log is durable and filterable.
- [ ] (2h) Compute the monthly report and routing slip from Postgres data. _Done-when:_ reports read
      persisted documents.

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

- [ ] (2h) `ConfigModule` env validation across all services + `ThrottlerModule` rate limiting on
      auth and mutations. _Done-when:_ limits are enforced and env is validated.
- [ ] (2h) `GET /health/ready` probes DB + Redis + object storage. _Done-when:_ readiness reflects
      every critical dependency.

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
