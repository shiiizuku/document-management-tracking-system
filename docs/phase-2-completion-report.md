# Phase 2 — Document Registry — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → _Phase 2 — Document registry_
**Branch / PR:** merged to `main` via PR #40 (merge commit `0b3afc5`), from
`feat/phase-2-document-registry-h94ufl`.

## Verdict

**Backend complete and verified end-to-end against Postgres. The frontend document UI remains
and is deferred to the UI track (consistent with the Phase 1 frontend deferral).**

The document registry is now durably persisted. The in-memory `DtsApplicationService` prototype
that previously backed documents, attachments, notifications and reports has been **retired** and
replaced by a Postgres-backed document module (`modules/documents/`), with the coupled attachment,
notification and report paths brought along so the running application stays coherent.

## Quality gate (as of merge)

| Check                                             | Result                              |
| ------------------------------------------------- | ----------------------------------- |
| `npm test -w @dts/api` (unit)                     | **188 passing / 0 failing** (23 files) |
| `npm run test:integration -w @dts/api` (Postgres) | **16 passing / 0 failing** (5 files)   |
| `npm run typecheck` (all workspaces)              | **0 errors**                        |
| `npm run lint` + Prettier                         | **clean**                           |
| `npm run build` (contracts + api + web)           | **succeeds**                        |
| CI (`quality` + `integration` jobs on PR #40)     | **green**                           |

## What was delivered

### Backend — implemented and tested

- **Document aggregate persistence** (`documents.repository.ts`, `documents.service.ts`) —
  replaces the `Map`-backed prototype:
  - **Create**: one transaction allocates the tracking number, allocates an outgoing reference
    (incoming keeps its external ref), inserts the row, and writes `audit_events` + `outbox_events`.
  - **Reference allocation**: outgoing references from `reference_counters` per division + year via
    atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`, inside the create transaction (gap-free,
    serializes under concurrency). Tracking numbers from a new office-wide `document_sequences`
    counter (migration `0003`) — unique, gaps tolerated.
  - **List/search**: authorization predicates are **in the SQL** (`documentScopeFor`) — scope,
    confidentiality, filters (status/priority/type/direction/division/section), search across
    title/tracking/reference/sender/company, deterministic sort (enum rank + `id` tiebreak), and
    limit/offset pagination. Nothing is post-filtered in app memory, so counts and totals respect
    scope.
  - **Metadata edit** (`PATCH /documents/:id/metadata`): optimistic-`version` concurrency (a stale
    edit is a `409`, never a silent overwrite), recording before/after in
    `document_metadata_revisions`; history exposed at `GET /documents/:id/metadata-revisions`.
  - **Workflow transitions**: the pure `WorkflowService` FSM remains the only decider; each action
    persists the `documents` row (optimistic `version`), a `workflow_events` timeline row, a release
    event on RELEASE, and `audit_events` + `outbox_events`, all in one transaction. A stale action is
    a `409`.
  - **Assignment** (`POST /documents/:id/assignments`): persisted to `document_assignments`
    (idempotent per recipient), with audit + outbox; assignment widens the recipient's readable
    scope.
- **Attachment coherence** (`files/attachment-store.ts`, `files/attachments.service.ts`) — the
  document row owns the current/signed version link (persistent); version metadata and bytes stay in
  an in-memory `AttachmentStore` until Phase 4. Upload/list/download/scan continue to work end to end
  (fail-closed download, IDOR guard, media-type sniffing, size limits) against the persisted row.
- **Reports / notifications** — `monthlyReport` now reads the persisted, scoped document set;
  `NotificationService` is an injectable singleton the assignment path notifies. Their own
  persistence lands in Phases 5–6.

### Schema & migrations

- `0003_document_sequences.sql` — office-wide tracking-number counter. `documents`,
  `document_metadata_revisions`, `workflow_events`, `document_assignments`, `release_events` and
  `reference_counters` (all already in the schema from Phase 0) are now actively written.

### Tests added this cycle

- `documents.int.test.ts` — HTTP + real Postgres: incoming/outgoing registration and reference
  allocation; **12 concurrent outgoing creates → 12 unique references and tracking numbers**;
  metadata history + stale-edit `409`; a cross-scope document excluded from a staff member's search
  **totals**; a persisted workflow transition with its timeline + stale-action `409`; assignment
  widening scope.
- DB-free unit doubles: `in-memory-documents.repository.ts` (reuses the pure `DocumentSearchService`
  + `AuthorizationPolicy` the SQL repository is proven to agree with), `in-memory-outbox.writer.ts`,
  `test-database.ts` (fake transactional `DATABASE`). `api.test.ts` and `file-api.test.ts` keep
  running without a database via these overrides.
- Retired `attachment-application.test.ts` (its service-level cases are covered at the HTTP level in
  `file-api.test.ts`, plus a new empty-upload case).

## "Done when" — met

Records staff can register and retrieve documents; no duplicate references (proven under 12-way
concurrency); counts and results respect scope (a cross-division document is absent from a staff
member's totals). Backend criteria satisfied; the frontend is the only open item.

## Outstanding / deferred

| #   | Item                                                       | Status                                                                                  |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| 1   | **Frontend document UI** (create form, detail + timeline, edit-with-conflict, list filters/sort/pagination) | **Deferred to the UI track**, consistent with the Phase 1 frontend deferral. Does not block later backend phases. |
| 2   | **`EXPLAIN`-driven indexes** on seeded representative data | Deferred to the Phase 6/hardening pass; the Phase 0 scope/sort indexes back these queries. |
| 3   | **Routing / sharing / soft-delete endpoints**             | Belong to Phase 3 (routing) and the deletion slice; workflow transitions + assignment were brought forward into Phase 2 for coherence. |
| 4   | **Attachment bytes still in memory**                       | By design until Phase 4 (MinIO + ClamAV); the document→version link is already persistent. |

## Environment notes

- Unit suite runs **without Postgres/Redis/MinIO** (in-memory doubles + fake transactional
  `DATABASE`). Integration tests (`*.int.test.ts`) need Postgres, are excluded from the default run,
  and drop/recreate `public` — invoke with `npm run test:integration -w @dts/api`, `DATABASE_URL`
  pointing at a **disposable** database and `ALLOW_DATABASE_RESET=true`.
- `npm test` passing does not imply typecheck passes — run `npm run typecheck` separately (build
  `@dts/contracts` first so its `dist/` resolves).
