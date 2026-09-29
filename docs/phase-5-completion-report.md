# Phase 5 — Outbox, Notifications & Dashboard — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → _Phase 5 — Outbox, notifications, dashboard_
**Branch / PR:** `feat/phase-2-document-registry-h94ufl` (see the Phase 5 PR).

## Verdict

**The durable notification pipeline (in-transaction inbox + transactional-outbox relay + BullMQ
worker) and the scope-aware dashboard are complete and verified against a real Postgres and a real
Redis. The realtime WebSocket gateway is deferred — the durable inbox works without it, and the
queue consumer is the seam it plugs into.**

## Quality gate

| Check                                             | Result                              |
| ------------------------------------------------- | ----------------------------------- |
| `npm test -w @dts/api` (unit)                     | **178 passing / 0 failing** (21 files) |
| `npm run test:integration -w @dts/api` (Postgres + Redis) | **28 passing / 0 failing** (7 files) |
| `npm run typecheck` (all workspaces)              | **0 errors**                        |
| `npm run lint` + Prettier                         | **clean**                           |
| `npm run build`                                   | **succeeds**                        |

## What was delivered

### Backend — implemented and tested

- **Durable notification inbox** (`notifications.repository.ts`) — notification rows are written in the
  **same transaction** as the domain change that produces them (the assignment tx), so a notification
  can never be lost because a background worker was down. Idempotent on `idempotency_key` (a repeat
  assignment produces no duplicate). Cursor-paginated list, unread count, mark-one/mark-all read.
- **Transactional-outbox relay** (`jobs/outbox-relay.ts`) — leases unpublished `outbox_events` with
  `FOR UPDATE SKIP LOCKED` (so multiple relay instances never fight over rows), enqueues each as an
  idempotent **BullMQ** job (jobId = the outbox row id), and marks them published, all in one
  transaction. The two failure windows are safe: an enqueue followed by a rolled-back transaction
  re-leases the row and BullMQ de-duplicates the re-`add`; a committed transaction publishes exactly
  once. Bounded retries + exponential backoff; failures kept for inspection.
- **Worker** (`worker.ts`) — runs the relay on an interval and a BullMQ `Worker` that consumes the
  queue. The consumer is the seam where realtime push / email delivery plug in (deferred).
- **Notifications API** — `GET /notifications?cursor=`, `POST /notifications/:id/read`,
  `POST /notifications/read-all`, all over Postgres, replacing the retired in-memory service.
- **Dashboard summary** (`GET /dashboard/summary`) — totals per workflow status + overdue count,
  computed from the same `documentScopeFor` predicate the list uses, so the dashboard can never show a
  number the list can't back up.
- **Infra**: a `redis` service was added to the CI integration job (with `REDIS_URL`), so the
  Redis-backed pipeline is exercised in CI, not just locally.

### Tests added this cycle

- `notifications.int.test.ts` (real Postgres + Redis): an assignment writes a durable notification in
  its transaction and it appears in the assignee's inbox; re-assigning is idempotent (no duplicate);
  mark-read drops the unread count; the **relay publishes a committed event onto the queue exactly
  once** and a **real BullMQ worker consumes it**, and a second relay pass re-enqueues nothing; the
  dashboard summary reflects the seeded documents.

## Outstanding / deferred

| #   | Item                                                     | Status                                                                                     |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **Realtime WS/SSE gateway** (subscribe, fan-out, catch-up) | **Deferred.** The queue consumer is the plug-in point; the durable inbox works without it. |
| 2   | **Wider audience resolver** (route/workflow → notifications) | Assignment is covered; route/workflow audiences are straightforward follow-ons.            |
| 3   | **Email / external delivery**                            | **Deferred** — another consumer of the same queue.                                          |
| 4   | **Frontend** (bell, inbox, dashboard cards)              | **Deferred to the UI track**, per prior phases.                                             |

## Environment notes

- The sandbox has no Docker daemon (Docker Desktop is a local-machine concept), so Redis and Postgres
  are run **natively** for local integration tests — the same real-service testing Docker would give.
  CI uses container `services:` for both. MinIO/ClamAV (Phase 4 infra) remain deferred as their
  binaries are not present.
- Integration tests need Postgres **and** Redis and drop/recreate `public`; run with `DATABASE_URL`
  (disposable DB), `REDIS_URL`, and `ALLOW_DATABASE_RESET=true`.
