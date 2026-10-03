# Implementation status & build backlog

_Last audited: 2026-10-03._ Every box below was re-checked against the code rather than against
the previous audit. Where a box and the code disagreed, the code won: boxes M7 had already satisfied
are now ticked where they were ticked, and the pre-rebuild filenames some ticks cited
(`registry-controls.tsx`, `metadata-edit-modal.tsx`, `route-modal.tsx`, `notifications-panel.tsx`,
`reports-view.tsx`) have been replaced with the files that exist.

This document is both a **status report** (what is real today) and a **working backlog**
(what to build next), sized for short daily sessions.

> **Ordering the remainder:** the nine open boxes and four policy gaps left after the 2026-10-03
> reconciliation are sequenced, with their dependencies, in
> [`phase-7-sequencing.md`](phase-7-sequencing.md). Read that before picking a box — three of them
> have prerequisites that are not obvious from the box text.

## How to use this backlog

- Each `- [ ]` box is scoped to roughly **one ~2-hour session**. Tick it when the _Done-when_
  check passes.
- Within every module the task order is fixed and vertical:
  **Backend → Frontend → Connections → Test → Audit/verify.** Work a module top to bottom.
- Modules are dependency-ordered. **Do Slice 0 first** — it establishes the persistence
  pattern everything else reuses. After that, M1–M5 can interleave; **M6 is continuous**
  (pick from it whenever a slice reaches "verify").
- A box that spills past one session is a sign it should be split — split it.
- At ~2 h/day, 5 days/week, the ~70 boxes below were roughly a **6–8 month horizon** (about
  the 24–30 week program the spec describes, re-expressed as free-time increments). As of the
  2026-10-03 reconciliation **9 boxes are open and 7 partial**, and all but three of them sit in
  M6 — the programme is now a hardening exercise, not a build-out.

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
  `audit_events` are persisted and queryable via `GET admin/audit-events` (actor/action/date filters,
  returning `{ items, total, limit, offset }`), and browsable at `/audit`.

**Runtime is fully wired:** `docker-compose.yml` defines postgres, redis, minio (built from source),
and clamav; the app writes attachment bytes to **MinIO** through the `StoragePort`, the worker
**auto-scans** each upload through **ClamAV** and records the verdict, and notifications fan out over
an authenticated **WebSocket** gateway (worker → Redis → per-user sockets). The backend is
feature-complete per this audit.

**The frontend is feature-complete for the pilot**, rebuilt on shadcn/ui across M7's F0–F2 (PRs
#64–#66, succeeding the first cut in #50–#56). Every surface the MVP boundary names now exists and is
routed: `/login` and `/request-account`; the registry with server-driven filters/sort/pagination/search,
document create, the detail route with timeline and allowed-actions bar, metadata edit with revision
history, forward/route; attachments with per-version scan badges, scan-gated download and inline
PDF/image preview; the notifications sheet over the live WebSocket; monthly reports with XLSX/PDF
export; the scope-aware dashboard (status totals, overdue, pending-by-division, recent activity, all
from `GET /dashboard/summary`); `/my-work`; `/audit`; `/admin/requests`, `/admin/users`,
`/admin/organization`; and capability-gated delete/restore plus the routing-slip download. The ⌘K
command palette is in too, mounted in the app shell: jump to a document by tracking number over the
server's scoped search, run the open document's `allowedActions`, or go to any destination the user
holds the capability for.

**What is left on the frontend is quality, not surface area:** the axe sweep, responsive/browser
matrix and Playwright E2E that the rebuild plan's decision 8 deferred to Phase 7.

**The core workflow revision landed after that audit.** Decisions 152–175 and ADR-0005/0006/0007 were
delivered as seven slices, all merged (PRs #83–#88): migration `0005`–`0008`, one status vocabulary in
`@dts/contracts` with `PENDING` derived rather than stored, the direction-branched workflow matrix,
the `DIRECTOR` role holding `DOCUMENT_SIGN` (taken from records staff and division heads),
non-destructive routing with custody on the route row, the Reference Document join table, the detail
view's right rail and reference modal, and `GET /roles` with a capability panel under every role
picker. `docs/TO - IMPLEMENT.md` carries the inherited constraints those slices impose on new code —
read them before adding a list, a report or anything that resolves a reference.

### Module verdict

| Module                | Today                                    | Gap to pilot                                                        |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| workflow              | **DONE** (pure FSM, tested)              | Persist transitions to `workflow_events`; transactional version bump |
| authorization         | **DONE** (pure RBAC/scope, tested)       | Enforce over _persisted_ users/divisions/sections                   |
| auth / session        | **DONE** (Postgres users, JWT + bcrypt)  | —                                                                   |
| documents / search    | **Postgres-backed** (Phase 2–3)          | UI **built** (registry list/filters/sort/pagination/search, create, detail+timeline, metadata edit, forward/route, delete/restore, routing slip). Remaining: the indexes exist (`documents_scope_status_idx`, `documents_created_at_idx`, `document_routes_unaccepted_idx`, `document_references_incoming_idx`); what is missing is an `EXPLAIN` pass over pilot-sized data to confirm they are the right ones |
| files / versions      | **Postgres metadata + MinIO storage + ClamAV auto-scan** (Phase 4) | UI **built** (upload, scan-status badges, gated download, inline preview of CLEAN PDFs/images). Remaining: — |
| notifications         | **Postgres in-tx + outbox relay/worker + realtime WS** (Phase 5) | UI **built** (inbox, unread badge, mark-read, live WS updates). Remaining: reconnect catch-up — the socket reconnects but invalidates nothing on `connect`, so events missed while down wait for the next refetch |
| reports / print       | **Postgres data + real XLSX/PDF** (Phase 6) | Reports UI **built** (month view + XLSX/PDF export), routing-slip download, audit-trail viewer, scope-aware dashboard. Remaining: — |
| admin / identity / org| **DONE** (account requests, org CRUD, roles, audit query, profile photos) | Admin & org UI and the request-an-account screen are **built**. Remaining: — |

### Infrastructure verdict

| Capability                     | Defined in code                                        | Connected to running app? |
| ------------------------------ | ------------------------------------------------------ | ------------------------- |
| Postgres + Drizzle             | Full schema (19 tables/7 enums), client, migration, seed | **Yes for identity + documents** — `DatabaseModule` provides the `DATABASE` token; identity and the document aggregate read/write Postgres. Attachment bytes/notifications not yet migrated |
| Object storage (MinIO/S3)      | `StoragePort` + `MinioStorageAdapter` + `objectKey` columns | **Yes** — the running app writes bytes to MinIO (`minio` SDK); tests override the port with the in-memory adapter. _(Local caveat: compose builds the vendored AGPL MinIO from `./minio` as `dts-minio:from-source`; a container still running the license-gated AIStor image will deny every S3 operation, so rebuild with `docker compose up --build`.)_ |
| BullMQ / Redis                 | `outbox-queue.ts` (queue + worker factories)           | **Yes** — the worker runs a relay + BullMQ consumer against Redis; tested in CI's integration job |
| Transactional outbox           | `outbox_events` + `OutboxWriter` + `OutboxRelay`       | **Writer + relay + consumer** — use cases enqueue in-tx; the relay leases (`FOR UPDATE SKIP LOCKED`) → BullMQ → mark published; the consumer fans out realtime notifications |
| Antivirus scan                 | `ClamAvScanner` (INSTREAM) + scan consumer + `POST …/scan` override | **Yes** — the worker scans each upload via clamd and records the verdict; manual endpoint remains for re-scans |
| WebSockets                     | Socket.IO `NotificationsGateway` + Redis `RealtimeBridge` | **Yes** — authenticated per-user realtime delivery; worker publishes, each API instance relays |
| Rate limiting                  | `ThrottlerModule`                                      | **Yes, globally** — `ThrottlerGuard` is an `APP_GUARD` with a 120/min default on every route, plus tight buckets on login (5/min) and account-request submission (3/min). Remaining: dedicated buckets for upload and report export |
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

- [x] (2h) Reconcile the `seed.ts` users with the capabilities/divisions the app expects, and
      delete the in-memory user seed from the `DtsApplicationService` constructor. _Done-when:_
      no user state remains in any `Map` and the authorization tests still pass. ✓ — four users are
      seeded against real placements (`admin` unplaced, `records` in RECORDS/INTAKE, `director` in
      the ORD with no section, `staff` in PILOT/GENERAL) and `DtsApplicationService` no longer
      exists anywhere in the tree. _(Decision 152's other half — the Records Unit as a Section
      inside the ORD — is tracked under M6 "Audit / policy", not here.)_

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

> Built in M7's F2, which supersedes these three boxes. Ticked here so the module reads true.

- [x] (2h) "Request an account" screen on the login page wired to the account-request endpoint.
      _Done-when:_ an unauthenticated visitor can submit a request. ✓ (`/request-account`,
      `features/admin/request-account-form.tsx`)
- [x] (2h) Admin console page: pending-request queue with approve/reject. _Done-when:_ an admin
      approves a request from the UI. ✓ (`/admin/requests`, `account-requests-screen.tsx`)
- [x] (2h) Admin console: user table + role assignment + division/section management.
      _Done-when:_ the org is manageable from the UI. ✓ (`/admin/users` → `users-screen.tsx` with
      `role-field.tsx`'s capability panel; `/admin/organization` → `organization-screen.tsx`)

**Connections**

- [x] (2h) Seed real divisions/sections/roles; confirm the app no longer depends on any in-memory
      identity. _Done-when:_ identity is fully Postgres-backed end to end. ✓

**Test**

- [x] (2h) Integration tests: request → approve → login, plus authz (a non-admin cannot approve).
      _Done-when:_ green in CI against Postgres. ✓ (`identity.int.test.ts`, "runs the account
      lifecycle: admin sets up the org, approves a request, the user signs in")

**Audit / verify**

- [x] (2h) Confirm every new endpoint enforces capability + scope, and that approvals/role changes
      write to `audit_events`. _Done-when:_ privileged actions appear in the audit trail. ✓ —
      `identity.int.test.ts` proves auth and admin actions land in a trail only administrators may
      read, and that the trail filters by user, action and date range.

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
      plus the work queue (`GET /documents/assigned`). _(Phase 3. Multi-recipient forwards and their
      completion semantics are **settled**, not deferred: decision 24 as amended on 2026-10-02 and
      ADR-0005 make exactly one recipient the lead that takes custody, with the rest for-information,
      and progress gates on the lead alone — `leadRouteOutstanding` in `workflow.service.ts`.)_
- [x] (2h) Logical deletion (soft-delete) endpoint + list exclusion, capability-gated. ✓ —
      `DELETE /documents/:id` and `POST /documents/:id/restore` under optimistic concurrency, gated by
      the new `DOCUMENT_DELETE` / existing `DOCUMENT_RESTORE` capabilities (admin-only); both audited
      and enqueued to the outbox. Covered by the Postgres integration flow.
- [x] (2h) Move `DocumentSearchService` filtering/sort/pagination to SQL (`DocumentsRepository.search`
      + `documentScopeFor`). _Done-when:_ search has parity with the in-memory version plus real pagination.

**Frontend**

- [x] (2h) List controls: filters (status/priority/type/direction/division/section), sort, and
      pagination. ✓ (`registry-screen.tsx` + `documents/url-state.ts` drive the server query.)
- [x] (2h) Metadata edit UI with a revision-history view. ✓ (`metadata-dialog.tsx`.)
- [x] (2h) Routing/forwarding UI in the detail panel. ✓ (`route-dialog.tsx`; the detail view's
      "Forward" action.)
- [x] (2h) Logical deletion + restore UI, guarded by capability. _Done-when:_ delete/restore works
      from the UI. ✓ (`delete-document-dialog.tsx` + `deleted-documents-dialog.tsx` over
      `GET /documents/deleted`, gated on `DOCUMENT_DELETE` / `DOCUMENT_RESTORE`.)

**Connections**

- [x] (2h) Enforce optimistic concurrency at the row level (`WHERE version = ?`), not in a Map.
      _Done-when:_ a stale action returns 409 from the database layer. ✓ (`documents.repository.ts`,
      `eq(documents.version, expectedVersion)` guards)

**Test**

- [x] (2h) Integration flow: create → edit → route → workflow → delete over Postgres, plus a
      concurrency-conflict case. _Done-when:_ green in CI. ✓ — `documents.int.test.ts` covers
      registration, a 12-way concurrent reference allocation, metadata edit with a `409` on a stale
      edit, non-destructive routing, forwards and shares, the work queue, and soft-delete →
      restore.

**Audit / verify**

- [x] (2h) Confirm every mutation writes a timeline + audit row and that cross-division reads are
      impossible. _Done-when:_ audit coverage complete, no scope leakage. ✓ — `query-scope.int.test.ts`
      and `authorization.test.ts` (30 cases, including forwarded sections, copied-in heads, and
      filtering before pagination and counting) hold the scope line; `documents.int.test.ts` asserts
      cross-scope documents stay out of both results and totals.

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

- [x] (2h) File-upload input in the register modal and detail panel (multipart to the attachments
      endpoint). ✓ (`attachments-section.tsx`.)
- [x] (2h) Version-history list with per-version scan-status badges. ✓
- [x] (2h) Download/preview control gated by scan state. ✓ Scan-gated download, plus in-page preview
      of `CLEAN` PDFs and images through `GET …/attachments/:versionId/content` (inline disposition,
      `nosniff`, a `default-src 'none' … sandbox` CSP, and a sandboxed frame on the client).

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

- [~] (2h) Re-verify allow-list, size limit, untrusted-filename handling, and the IDOR guard against
      the MinIO-backed paths. _Partial:_ `file-api.test.ts` and `files.int.test.ts` cover the
      allow-list by magic bytes (spoofed media type, macro-enabled `.docm` refused), the empty
      upload, the fail-closed download, the preview lockdown, and the IDOR guard through a sibling
      document. _Remaining:_ nothing asserts an over-`UPLOAD_MAX_BYTES` upload is rejected, and the
      file suites run against the in-memory `StoragePort`, so none of it is yet proven on MinIO.

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
      (tested against real Redis). ✓
- [x] (2h) Authenticated WebSocket gateway for realtime delivery. ✓ — Socket.IO `NotificationsGateway`
      authenticates the handshake with the same `dts_session` cookie as REST and joins a per-user
      room; the worker's outbox consumer publishes to a Redis channel (`RealtimePublisher`) and each
      API instance's `RealtimeBridge` relays it to that user's sockets. Proven end-to-end (authenticated
      delivery, no cross-user leakage, unauthenticated socket rejected) against real Postgres + Redis.

**Frontend**

- [x] (2h) Notifications inbox: render the fetched list (stop discarding it), with relative times
      and unread styling. ✓ (`notifications-sheet.tsx`.)
- [x] (2h) Mark-as-read (single + all) wired to the endpoint; the badge updates. ✓
- [~] (2h) Live updates over WS/SSE with reconnect + catch-up on focus. _Partial:_ live WS updates
      work (`features/realtime/use-realtime-sync.ts`). _Remaining:_ Socket.IO reconnects on its own,
      but the `connect` handler only sets `connected` — it invalidates nothing — so every event that
      arrived while the socket was down is picked up on the next navigation or refetch rather than on
      reconnect. One `invalidateNotifications` in that handler is most of the fix.

**Connections**

- [x] (2h) Add Redis to `docker-compose.yml`, wire the BullMQ connection, and run the worker via
      `start:worker`. _Done-when:_ outbox → queue → push works end to end locally. ✓ (redis + worker
      services defined; relay/worker tested against real Redis in CI)

**Test**

- [~] (2h) Tests: outbox delivered exactly once; realtime reconnect/catch-up. _Partial:_
      `notifications.int.test.ts` proves committed outbox events reach the queue exactly once and a
      worker consumes them. _Remaining:_ the reconnect/catch-up case, which needs the client fix in
      the box above before it can be asserted.

**Audit / verify**

- [x] (2h) Confirm notifications are scope-correct (no cross-division leakage) and the WS handshake
      is authenticated. _Done-when:_ verified. ✓ — `realtime.int.test.ts` delivers to the recipient's
      authenticated socket, withholds a notification meant for another user, and rejects a socket
      that presents no session.

---

## M5 · Reports, audit trail & print

**Backend**

- [x] (2h) Persist `audit_events` to Postgres and add a query endpoint with filters
      (actor/date/outcome). _Done-when:_ the audit log is durable and filterable. ✓ (`audit.writer.ts`
      + `GET admin/audit-events`)
- [x] (2h) Compute the monthly report and routing slip from Postgres data. _Done-when:_ reports read
      persisted documents. ✓ (`monthly-report.service.ts` over scoped Postgres documents)

**Frontend**

- [x] (2h) Reports page: month picker, on-screen view, and XLSX/PDF download (endpoints already
      exist). ✓ (`reports-screen.tsx`.)
- [x] (2h) Routing-slip download from the document detail panel. _Done-when:_ the slip downloads. ✓
      (`routing-slip-dialog.tsx`; the slip carries the bureau letterhead and the approved seal from
      `apps/api/assets/mgb-seal.png`.)
- [x] (2h) Audit-trail viewer page with filters. _Done-when:_ the audit log is browsable. ✓
      (`/audit` → `audit-screen.tsx`, filters held in the URL by `audit/url-state.ts`.)
- [x] (2h) Dashboard richness: pending-by-division, overdue highlighting, recent-activity feed.
      _Done-when:_ the richer metrics render. ✓ (`dashboard-screen.tsx` over
      `GET /dashboard/summary`; `pendingByDivision` composes the `documentIsPending` predicate, so
      the tiles are scope-correct rather than counted from the loaded page.)

**Test**

- [x] (2h) Tests: report math over seeded Postgres, audit-filter correctness, and the
      spreadsheet-injection guard (`sanitizeSpreadsheetCell`). _Done-when:_ green. ✓ —
      `monthly-report.test.ts` (report math + the injection guard), `identity.int.test.ts` (audit
      filtering and pagination), `routing-slip.test.ts`, and `documents.int.test.ts`'s
      cross-division assignment counted on the assignee's monthly report.

**Audit / verify**

- [x] (2h) Confirm report/audit access is gated by `REPORT_VIEW` / `AUDIT_VIEW`. _Done-when:_
      unauthorized callers are blocked. ✓ — `documents.service.ts` refuses the report without
      `REPORT_VIEW`; `identity.policies.ts` gates the audit list on `AUDIT_VIEW`, asserted by
      `identity.int.test.ts` and `role-capabilities.test.ts`.

---

## M7 · Frontend rebuild on shadcn/ui

Design, decisions and module seams: `docs/frontend-rebuild-plan.md`. This module **superseded** the
_Frontend_ boxes in M1–M5 — those surfaces were built here, not in `DtsApp`, which is why the boxes
up there are ticked with files under `apps/web/src/features/`. Order was fixed:
**F0 → F1 → F2**.

**F0 — Foundation**

- [x] (2h) Style-isolation spike: one shadcn page rendered beside `globals.css`; choose how the old
      sheet is scoped. _Done-when:_ new and old screens render side by side without breaking each other.
- [x] (2h) Install Tailwind v4 + shadcn (`components.json`); port palette/type/radii into the shadcn
      CSS variables. _Done-when:_ a restyled `Button`/`Input`/`Dialog` matches the current brand.
- [x] (2h) Transport: richer `ApiError` (`code`, `details`, `correlationId`) + a `download(path,
      filename)` helper for binary responses. _Done-when:_ unit tests cover the 409/403/field-error
      shapes and a PDF download.
- [x] (2h) `QueryClientProvider` with global 401 handling (clear cache → `/login?next=`), sonner
      `<Toaster>`. _Done-when:_ an expired session redirects with a toast.
- [x] (2h) `(public)`/`(app)` route groups, session gate, sidebar + topbar, capability-filtered nav;
      export capability names from `@dts/contracts`. _Done-when:_ nav items appear only for capable users.
- [x] (2h) `DataTable` (server pagination/sort) + `FilterBar` + `PageHeader` + `EmptyState` +
      skeletons. _Done-when:_ the components render against a stubbed `api()` in a test.

**F1 — Parity rebuild**

- [x] (2h) `/login` on shadcn + RHF/zod (`loginSchema`); seeded credentials prefilled in development
      builds only. _Done-when:_ a production build shows empty fields.
- [x] (2h) `/documents` list via `features/documents` hooks, filters + page in search params.
      _Done-when:_ a filtered URL reloads to the same view; back button works.
- [x] (2h) `/documents/[id]`: metadata, timeline, `DocumentActions` with remark/release-method dialogs
      (no `window.prompt`). _Done-when:_ every allowed action runs from a dialog.
- [x] (2h) Detail: edit-metadata and forward/route forms on RHF + `applyServerErrors`; a 409 refetches
      with a "changed — retry" message. _Done-when:_ a stale edit recovers without a reload.
- [x] (2h) Attachments: upload, scan badges, scan-gated download via `download()`. _Done-when:_ parity
      with `attachments-section.tsx`.
- [x] (2h) Notifications sheet + `useRealtimeSync()`; optimistic mark-read with rollback.
      _Done-when:_ a live event appears and the badge updates without a refresh.
- [x] (2h) `/reports` with XLSX/PDF via `download()`. _Done-when:_ parity with `reports-view.tsx`.
- [x] (2h) Retire `dts-app.tsx` and `globals.css`. _Done-when:_ neither file exists and every route
      still renders.

**F2 — New surfaces**

- [x] (2h) Backend: pending-by-division (scoped by `documentScopeFor`) + scoped recent-activity feed.
      _Done-when:_ the division counts reconcile with the filtered list in an integration test.
- [x] (2h) `/dashboard` on `GET /dashboard/summary` + the new data (status totals, overdue, division
      chart, activity). _Done-when:_ the tiles no longer count the loaded page client-side.
- [x] (2h) `/my-work` over `GET /documents/assigned`. _Done-when:_ an assignee sees their queue.
- [x] (2h) `/audit` viewer with user/action/date filters in the URL. _Done-when:_ the audit log is
      browsable and filterable. _Also:_ `GET /audit-events` now returns `{ items, total, limit, offset }`
      so the viewer can say whether it is showing everything or the first page.
- [x] (2h) `/admin/requests`: pending queue, approve (role/division/section) and reject.
      _Done-when:_ an admin approves a request from the UI.
- [x] (2h) `/admin/users`: create, edit role/placement, deactivate. _Done-when:_ users are manageable
      from the UI.
- [x] (2h) `/admin/organization`: division/section CRUD. _Done-when:_ the org structure is manageable
      from the UI.
- [x] (2h) `/request-account` public form (`submitAccountRequestSchema`). _Done-when:_ a visitor
      submits a request.
- [x] (2h) Delete/restore controls (capability-gated) + routing-slip download. _Done-when:_ both work
      from the detail page. _Also:_ `GET /documents/deleted` — restore needs a document's current
      `version`, and no other read path can see a deleted row.
- [x] (2h) Backend + UI: inline preview for `CLEAN` PDFs/images (inline disposition, `nosniff`,
      restrictive CSP). _Done-when:_ a clean PDF previews in-page; non-clean files cannot.

**Later**

- [x] (2h) ⌘K command palette (jump to tracking number, run allowed actions). _Done-when:_ the
      palette opens from the keyboard and is listed in the UI. ✓ — mounted in the app shell beside
      the notifications bell, opened with ⌘K/Ctrl+K **or** the topbar button that prints the chord
      (D-99's discoverability half). Three groups: the open document's `allowedActions`, documents
      matching the typed term over a capped server search, and the capability-filtered destinations
      from the same table the sidebar renders. _Also:_ the workflow-action mutation no longer seeds
      the detail cache from its response — that response is the document's **summary**, so seeding
      it put an object with no `allowedActions` where the detail screen reads one and crashed the
      screen after every successful action.

---

## M6 · Hardening & pilot evidence _(continuous)_

Pull from this list whenever a slice above reaches "verify."

**Backend / infra**

- [~] (2h) `ConfigModule` env validation across all services + `ThrottlerModule` rate limiting on
      auth and mutations. _Partial:_ env validated at boot. `ThrottlerGuard` is an `APP_GUARD`, so a
      default bucket of **120 requests/minute covers every route**, with tight per-route buckets on
      login (5/min) and account-request submission (3/min); `rate-limit.test.ts` proves the login cap
      returns `429` and that the tight window does not leak onto ordinary authenticated routes.
      _Remaining:_ the expensive mutations — attachment upload and report export — still sit on the
      120/min default and want buckets of their own.
- [x] (2h) Readiness probes every critical dependency, split by process so each probes its own
      request path: the API's `GET /health/ready` (and `/ready`) probes **Postgres + object storage**,
      and the worker's `/ready` probes **Postgres + Redis**. Each probe runs under a 2s timeout and
      fails closed (503) with a safe envelope. ✓

**Test / evidence**

- [~] (2h) Postgres + MinIO integration harness (compose or testcontainers) running in CI.
      _Partial:_ CI's `integration (postgres)` job provisions **Postgres + Redis** as services and runs
      `test:integration`. _Remaining:_ **MinIO and ClamAV are not in CI** — the file suites override
      `StoragePort` with the in-memory adapter, so no CI job exercises real object storage or a real
      scanner. This box blocks the M3 EICAR test and the M3 audit box below it.
- [ ] (2h) Playwright E2E: login → register document → upload → workflow → release. _Done-when:_
      the E2E flow is green in CI.
- [ ] (2h) Accessibility automation (axe) on the key screens. _Done-when:_ no critical violations.
- [~] (2h) Security tests: authorization matrix, IDOR, upload abuse, rate limits. _Partial:_ the
      authorization matrix (`authorization.test.ts`, 30 cases incl. the confidentiality gate and the
      Director's office-wide read), IDOR (`file-api.test.ts`, `files.int.test.ts`), media-type
      spoofing and macro refusal, CSRF (`csrf.guard.test.ts`) and rate limits
      (`rate-limit.test.ts`) are all covered. _Remaining:_ the oversize upload, a dependency and
      container scan, a secure-headers/CORS-allowlist assertion, and a log-redaction check.
- [ ] (2h) Representative-load test (search + upload + workflow). _Done-when:_ latency/throughput
      are recorded against a target.
- [ ] (2h) Backup/restore rehearsal for coordinated Postgres + MinIO using `scripts/backup.sh` and
      `scripts/restore.sh`. _Done-when:_ a restore is verified against a checklist.

**Audit / policy**

- [~] (2h) Resolve the open policy decisions and encode each (no hard-coded placeholder heuristics).
      _Partial:_ all 14 rows of `policy-register.md` now carry a decision, and records policy (P-01),
      reference format (P-02), **branding (P-03 — the letterhead is transcribed verbatim and the
      approved seal ships at `apps/api/assets/mgb-seal.png`, read once by `ReportExportService`)**,
      the SLA calendar (P-04), signature meaning (P-05), the allow-list and 25 MB limit (P-06),
      scanner posture (P-07), disposal (P-09), session timeout (P-10), provisioning (P-11),
      cross-division visibility (P-12) and PII-in-logs (P-14) are each reflected in code.
      _Remaining, and each a real code change:_
      - **Audit retention (P-08)** — 5-year retain-then-relocate is decided; the code retains
        everything in the primary database with no window and no relocation path. Nothing to decide,
        only to build.
      - **Release methods (decision 27 as amended)** — still the `release_method` pgEnum
        (`MAILED`, `EMAILED`, `PICKED_UP`, `DELIVERED`). The decision calls for configurable rows
        seeded Emailed / Postal / LBC / JRS / Picked Up / Personally Delivered, so LBC and JRS are
        currently unrepresentable.
      - **Decision 152's other half** — the Records Unit should be a Section inside the ORD, not the
        standalone `RECORDS` division `seed.ts` still creates. Until it lands the seeded records
        officer sits outside the ORD and its drafts take the ordinary `FOR_INITIAL` path, so
        ADR-0007's exemption is reachable only by hand.
      - **Director account** — `director@dts.local` carries the shared development password.
        ADR-0006 makes a real Regional Director account a deployment-ordering constraint, because
        release is gated on a signature nobody else may make.
      - **Parallel-route completion semantics** — still deferred as an open policy question.
- [ ] (2h) Runbooks for the remaining failure modes. _Done-when:_ each has a rehearsed runbook.
      _(`docs/runbooks/backup-restore.md` exists; incident response, scanner-down and Redis-loss do
      not.)_

---

_No unresolved policy is encoded as permanent behavior. Audit retention remains preserve-by-default
for development only, with no automated purge, until the M6 policy box above is resolved._
