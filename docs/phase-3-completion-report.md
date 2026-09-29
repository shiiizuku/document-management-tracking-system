# Phase 3 — Workflow & Routing — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → _Phase 3 — Workflow & routing_
**Branch / PR:** merged to `main` via PR #41 (merge commit `bfd6e0a`), from
`feat/phase-2-document-registry-h94ufl`.

## Verdict

**Backend mostly complete and verified against Postgres. Two items are deferred with documented
reasons (not dropped); the frontend follows on the UI track.**

Phase 3's core — the server-enforced workflow FSM, `allowed-actions`, persisted transitions and
assignment — landed with Phase 2 (brought forward so the running app stayed coherent when
`DtsApplicationService` was retired). This cycle added the **routing** half: forwarding, sharing and
the work queue.

## Quality gate (as of merge)

| Check                                             | Result                              |
| ------------------------------------------------- | ----------------------------------- |
| `npm test -w @dts/api` (unit)                     | **188 passing / 0 failing** (23 files) |
| `npm run test:integration -w @dts/api` (Postgres) | **19 passing / 0 failing** (5 files)   |
| `npm run typecheck` (all workspaces)              | **0 errors**                        |
| `npm run lint` + Prettier                         | **clean**                           |
| `npm run build`                                   | **succeeds**                        |
| CI (`quality` + `integration` on PR #41)          | **green**                           |

## What was delivered

### Backend — implemented and tested

- **Routing / forwarding** (`POST /documents/:id/routes`) — moves a document to another division
  (and optional section) under the optimistic-`version` guard, and records the hop in
  `document_routes` (from → to, routed-by, remarks). A no-op self-route is rejected (`ROUTE_NO_OP`);
  the target division/section is validated (exists / active / belongs) before the move; the change is
  transactional with `audit_events` + `outbox_events`. Because scope keys on the owning
  division/section, forwarding naturally hands visibility to the destination and removes it from the
  origin (records staff/administrators still see everything).
- **Sharing** (`POST /documents/:id/shares`) — grants one user read access via `document_shares`
  (idempotent), **without** moving or reassigning the document; transactional with audit + outbox.
- **Work queue** (`GET /documents/assigned`) — live documents the caller holds an active assignment
  on.
- Document **detail** now exposes the route history alongside the timeline, assignees and shares.
- Routing and sharing are capability-gated (`DOCUMENT_ASSIGN`) and scope-checked (an actor who
  cannot read the document gets a 404, never a leak).

### Already in place from Phase 2 (the workflow core)

- The pure `WorkflowService` FSM is the only decider of `workflow_status`; `executeAction` is the only
  writer, persisting each transition + `workflow_events` + audit + outbox (+ a `release_events` row on
  RELEASE) in one transaction, under optimistic concurrency. `allowed-actions` filters by capability
  and state; return-for-revision requires a remark.

### Tests added this cycle

- Integration (`documents.int.test.ts`): **routing moves a document out of a staff member's scope**
  and records the hop; **a share brings an out-of-scope document into a user's reach** without
  relocating it; **an assigned document appears on the assignee's work queue**.
- The in-memory `DocumentsRepository` double gained routing/sharing/work-queue so the DB-free unit
  suites stay green.

## Outstanding / deferred

| #   | Item                                        | Status                                                                                                   |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1   | **`signature_events` persistence**          | **Deferred to Phase 4.** The table FKs `file_versions`, which is not persisted yet (attachment versions still live in the in-memory store). SIGN records the signed version on the document row (`signedFileVersionId`), which is what the release invariant reads. An attempt to persist it in this cycle surfaced exactly this FK gap and was reverted. |
| 2   | **Parallel routes + completion semantics**  | **Deferred — open policy** ("per agreement" in the plan). This cycle does single-destination forwarding that moves ownership; multi-destination routes with completion tracking need the office's routing rules pinned down first. |
| 3   | **Guards as individually-named pure functions** | Cosmetic. Guards (remark-required, clean-and-signed attachment, release-method) currently live inside `WorkflowService.execute`; extracting them is a tidy-up, not a behavior change. |
| 4   | **Frontend** (action bar from `allowed-actions`, assign/route pickers, work-queue views, timeline) | **Deferred to the UI track**, consistent with the Phase 1/2 frontend deferral. |

## Gate before Phase 4

Phase 4 (Files & scanning) is what unblocks item #1: once `file_versions` is persisted, signature and
scan events can reference it. The workflow release invariant (outgoing needs a clean, signed current
attachment) is already enforced from the document row and the scan store, and will move to reading
persisted `file_versions` in Phase 4.
