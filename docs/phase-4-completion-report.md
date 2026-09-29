# Phase 4 — Files & Scanning — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → _Phase 4 — Files & scanning_
**Branch / PR:** `feat/phase-2-document-registry-h94ufl` (see the Phase 4 PR).

## Verdict

**Attachment persistence and the storage seam are complete and verified against Postgres. The
scanner infrastructure (MinIO adapter + ClamAV worker) is deferred with a documented reason — it
needs running services the environment can't host, and belongs with the infra it targets.**

Attachment metadata moved from the in-memory prototype into Postgres, bytes moved behind a storage
port, and the `signature_events` deferral from Phase 3 is closed.

## Quality gate (as of the Phase 4 PR)

| Check                                             | Result                              |
| ------------------------------------------------- | ----------------------------------- |
| `npm test -w @dts/api` (unit)                     | **181 passing / 0 failing** (22 files) |
| `npm run test:integration -w @dts/api` (Postgres) | **24 passing / 0 failing** (6 files)   |
| `npm run typecheck` (all workspaces)              | **0 errors**                        |
| `npm run lint` + Prettier                         | **clean**                           |
| `npm run build`                                   | **succeeds**                        |

## What was delivered

### Backend — implemented and tested

- **`file_records` + `file_versions` persisted** (`files/file-versions.repository.ts`). A version is
  immutable except for its `scan_status`, which may only advance from a pending state to a final one;
  a final result (CLEAN/INFECTED) cannot change (a repeat is an idempotent no-op, a different result a
  `409 SCAN_RESULT_CONFLICT`). Version numbering is per file record, guarded by the unique
  `(file_record_id, version_number)` index.
- **`StoragePort`** (`files/storage.port.ts`) — the byte-storage seam: `put` (no overwrite, keys
  generated server-side as `quarantine/<record>/<n>-<uuid>`) and `get`. The current binding is an
  in-memory adapter; a MinIO/S3 adapter is a drop-in that leaves the use cases untouched.
- **`AttachmentsService`** rewired onto the repository + port: upload sniffs the real media type from
  magic bytes, enforces the 25 MB limit and the format allow-list, writes metadata in a transaction,
  then stores bytes under the quarantine key and points the document at the new current version
  (resetting clean-state and bumping the row version). List/download/scan read persisted state.
- **Fail-closed download** — bytes never leave quarantine unless the version is CLEAN; the
  cross-document **IDOR guard** is a SQL join (a sibling document's path yields 404).
- **`signature_events` persisted** on SIGN (now that `file_versions` exists — the FK the Phase 3
  attempt tripped on is satisfied); document detail exposes the signatures. The outgoing-release
  invariant (current attachment CLEAN **and** signed) is evaluated from the persisted version and the
  document row.
- `DtsApplicationService`'s last file remnants (`AttachmentStore`, `FileVersionService`) are removed.

### Tests added this cycle

- `files.int.test.ts` (real Postgres): upload → quarantine → **download blocked until CLEAN** →
  download serves the bytes and reads the version back from Postgres; spoofed media type → 415; a
  final scan result is immutable (409); the IDOR guard denies a sibling-document path; and a
  **persisted `signature_events` row** is recorded against the signed version through the full
  ACCEPT → SUBMIT_FOR_SIGNATURE → SIGN flow.
- Unit suites stay database-free via an in-memory `FileVersionsRepository` double and the in-memory
  `StoragePort` adapter; `file-api.test.ts` continues to exercise the whole upload/scan/release flow
  without a database.

## Outstanding / deferred

| #   | Item                                        | Status                                                                                       |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **MinIO/S3 storage adapter**                | **Deferred.** The `StoragePort` is the seam; a MinIO adapter drops in with no use-case change. Needs a running MinIO. |
| 2   | **ClamAV scan worker** (BullMQ/Redis)       | **Deferred.** Needs ClamAV + Redis. The manual `POST …/scan` endpoint stands in; upload already quarantines and download fails closed. Upload will enqueue a scan via the outbox when the worker lands. |
| 3   | **Streamed / presigned download**           | **Deferred** — lands with the MinIO adapter; current download reads bytes through the port. |
| 4   | **Frontend** (multi-file upload, version chips, preview) | **Deferred to the UI track**, consistent with prior phases. |

## Environment notes

- The scanner/worker deferrals are forced by the sandbox: MinIO, ClamAV and Redis are not running and
  cannot be provisioned here, so wiring them would be untested speculative code. The persistence and
  fail-closed guarantees that _can_ be proven against real Postgres are, and the storage boundary is
  drawn so the infra work is an adapter swap rather than a rewrite.
- Integration tests need Postgres and drop/recreate `public`; run with `DATABASE_URL` on a disposable
  database and `ALLOW_DATABASE_RESET=true`.
