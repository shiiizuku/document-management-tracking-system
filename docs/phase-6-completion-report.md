# Phase 6 — Reports, Routing Slip & Audit UI — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → _Phase 6 — Reports, routing slip, audit UI_
**Branch:** `feat/phase-6-reports-audit` (merged to local `main`)

## Verdict

**The Phase 6 backend is complete and verified against a real Postgres and a real Redis running
in Docker.** Monthly reports (JSON / PDF / XLSX), the routing-slip PDF, and the audit-trail query
API all exist, are scope-aware, and are audited. This cycle closed the two remaining gaps against
the spec: the audit query now supports the documented `user`/`action`/`from`/`to` filters with
pagination, and **every file export is now recorded as its own audit event**. Frontend (report
page, routing-slip print action, audit table) remains **deferred to the UI track**, consistent with
every prior phase.

## Quality gate

| Check                                                      | Result                                 |
| ---------------------------------------------------------- | -------------------------------------- |
| `npm test -w @dts/api` (unit)                              | **179 passing / 0 failing** (21 files) |
| `npm run test:integration -w @dts/api` (Postgres + Redis)  | **29 passing / 0 failing** (7 files)   |
| `npm run typecheck` (all workspaces)                       | **0 errors**                           |
| `npm run lint` (eslint `--max-warnings=0`)                 | **clean**                              |

Integration tests were run under **Docker**: an isolated `postgres:16-alpine` on host port **5433**
(kept separate from the already-running app stack on 5432 so the destructive schema-reset suites
could not touch live data) and `redis:7-alpine` on 6379.

## Starting point (already delivered in Phases 0–5)

Most of Phase 6 landed earlier and was confirmed still working:

- `GET /reports/monthly`, `/reports/monthly.pdf`, `/reports/monthly.xlsx` — scope-aware aggregate
  queries (`monthly-report.service.ts`, `report-export.service.ts`), gated on `REPORT_VIEW` and
  scoped through `documentScopeFor` / `filterReadable`.
- **Spreadsheet formula-injection defence** — `sanitizeSpreadsheetCell` prefixes any cell starting
  with `= + - @` (also after leading tab/CR/LF/space) with a `'`.
- `GET /documents/{id}/routing-slip.pdf` — branded PDF with the document header and full timeline.
- `GET /audit-events` — auditor/admin only (`audit-event:list` capability), insert-and-read-only.

## What was delivered this cycle

### 1. Audit query API — `user` / `action` / `from` / `to` + pagination

- `AuditQuery` (`modules/audit/audit.writer.ts`) gained `from?: Date`, `to?: Date`, and
  `offset?: number`. `DrizzleAuditWriter.list` now applies `occurredAt >= from` (inclusive) and
  `occurredAt < to` (exclusive) so a caller can page day-by-day without double-counting the boundary
  instant, and applies `.offset(...)`. All filters ride the existing composite index
  `(actor_id, action, occurred_at)` — **no migration required**.
- `GET /audit-events` (`modules/admin/admin.controller.ts`) now accepts `?user=` (the documented
  name, with `actorId` kept as an alias), `?action=`, `?from=`, `?to=`, `?limit=`, `?offset=`.
  ISO-8601 dates are parsed and **rejected with `400`** if malformed; `limit`/`offset` must be
  non-negative integers. The `audit-event:list` authorization assertion is unchanged.

### 2. Every export is audited as a distinct download event

A downloaded file can leave the office, so an export is a materially different, exfiltration-relevant
event from an on-screen view. On-screen report viewing already wrote `report.monthly-viewed`; this
cycle adds:

- `report.exported` (`reports.controller.ts`) for **both** `monthly.pdf` and `monthly.xlsx`, with
  `summary { format, year, month }`.
- `document.routing-slip-exported` (`documents.controller.ts`) for `routing-slip.pdf`, with
  `targetId` = the document id and `summary { format: 'pdf' }` — the plain document detail read is
  still not audited, but exporting the printable dossier now is.

Both carry **IDs, format and period only** — never document body text or party names — per audit
policy P-14.

### Tests added this cycle

- **`api.test.ts` (unit, in-memory):** logs in, creates a document, hits `monthly.xlsx`,
  `monthly.pdf`, and `routing-slip.pdf`, and asserts exactly three export audit entries in order with
  the right actions/targets/formats — plus a guard that no summary leaks the title or sender.
- **`identity.int.test.ts` (real Postgres):** exercises the audit query end-to-end over HTTP —
  `action` filter (every row matches), `user` alias (rows belong to the actor), `from`/`to` window
  (recent rows in a window ending in the future; none in a window starting in the future),
  `limit`/`offset` pagination (distinct pages), and a `400` for a malformed `from`.

## Outstanding / deferred

| #   | Item                                                             | Status                                                                 |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | **Frontend** (report page + export buttons, routing-slip print, audit table + filters) | **Deferred to the UI track**, per every prior phase.                   |
| 2   | **Dedicated report tables / materialised aggregates**            | Not needed yet — reports compute live from the document tables and reconcile with the scoped list. Revisit in the Phase 7 `EXPLAIN`/perf pass if pilot-sized data warrants it. |
| 3   | **Wider report cuts** (per-division breakdowns, quarterly rollups) | Straightforward follow-ons on the same scope-aware query.              |

## Environment notes

- Integration tests drop and recreate the `public` schema, so they must run against a **disposable**
  database. Run with `DATABASE_URL` (here `postgresql://dts:dts@localhost:5433/dts`), `REDIS_URL`,
  and `ALLOW_DATABASE_RESET=true`.
- The Docker test Postgres was brought up on host port 5433 via
  `POSTGRES_HOST_PORT=5433 docker compose up -d postgres` precisely to avoid the live stack on 5432.
- MinIO/ClamAV (Phase 4 infra) remain deferred; Phase 6 does not depend on them.
