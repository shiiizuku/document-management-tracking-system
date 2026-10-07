# Policy register

Every policy question that changes **system behaviour** and is owned by the institution
rather than by engineering. A question is listed here the moment code needs an answer, so
that no placeholder heuristic silently becomes permanent behaviour.

**Status values**

- `OPEN` — no decision; code carries a documented provisional default.
- `PROVISIONAL` — engineering chose a defensible default to stay unblocked; the owner has
  not confirmed it.
- `DECIDED` — the owner answered, but the code does not match yet. The answer is binding;
  the row reaches `AGREED` when the implementation lands.
- `AGREED` — the owner confirmed it and the code matches.

Provisional defaults are **dev/pilot-only**. `OPEN`, `PROVISIONAL` and `DECIDED` rows must all
reach `AGREED` before the Phase 7 readiness sign-off.

_Last reviewed: 2026-10-06._ Every row is `AGREED`. P-15 went back to `DECIDED` when the
Records section answered the outstanding `MAILED` question with a two-level model. It returned to
`AGREED` the same day, once migration `0013` encoded it (box D5). P-08's archive host is
**deliberately deferred to 2031**: nothing needs it until the first audit event turns five, and the
relocation command refuses to run until `AUDIT_ARCHIVE_DATABASE_URL` is set. P-13 is `AGREED`, and
on 2026-10-06 its restore was rehearsed from the NAS (box D3). Decided the same day: **attachments
are mirrored often enough to meet the same recovery point as the database**, not only nightly; the
mirror runs every 3 minutes.

| #    | Policy question                                                                                   | Owner            | Status        | Current behaviour in code                                                                                                      | Blocks    |
| ---- | ------------------------------------------------------------------------------------------------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| P-01 | **Records policy** — which document classes are tracked, and what counts as a complete record      | Records section  | `AGREED` | Tracked classes: incoming, outgoing, FOI, and DENR 8888 Action Center. `DOCUMENT_TYPES` carries all four; the column itself is free text, so that list is the whole of the restriction | Phase 2   |
| P-02 | **Reference-number format** — segments, padding, reset period, per-division vs. global scope        | Records section  | `AGREED` | Confirmed as shipped: `DTS-<year>-<6 digits>` tracking, `<DIVISION>-<year>-<5 digits>` reference, allocated atomically per division and year | Phase 2   |
| P-03 | **Branding** — seal, letterhead, and name block on routing slips and PDF exports                    | Admin office     | `AGREED` | Shipped. The bureau letterhead and name block are transcribed verbatim from `Document Routing Slip.doc` into `report-export.service.ts`; the approved seal (decision 64) ships as `apps/api/assets/mgb-seal.png` and is read once rather than per request, with a missing seal degrading to a usable unsealed slip. The web shell carries `apps/web/public/mgb-logo.png` | Phase 6   |
| P-04 | **SLA calendar** — working hours, holidays, and what makes a document "overdue"                    | Admin office     | `AGREED` | Overdue is counted in **elapsed calendar days** — no working-hours or holiday calendar. A target date is set per document and pinned to the end of that day, so a document is not overdue on the day it falls due | Phase 5   |
| P-05 | **Signature meaning** — whether the internal signature record is legally sufficient, or a qualified e-signature is required | General counsel  | `AGREED` | The internal signature record is tracking metadata and carries no legal effect; documents are signed outside the system. `signature_events` already records only the internal act | Phase 3/4 |
| P-06 | **File allow-list and size limit**                                                                 | IT security      | `AGREED` | `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, plus `.docx` and `.xlsx`; macro-enabled `.docm`/`.xlsm` refused. Verified by magic bytes. 25 MB ceiling (`UPLOAD_MAX_BYTES`). Preview stays PDF/images, and release requires a PDF or image attachment | Phase 4   |
| P-07 | **Scanner failure posture** — what happens when ClamAV is down or times out                         | IT security      | `AGREED` | **Fail closed** — a version that is not `CLEAN` is never downloadable; after 5 bounded retries the scan job is parked and the version stays `PENDING` until an operator requeues it ([`runbooks/scanner-down.md`](runbooks/scanner-down.md)). `SCAN_FAILED` is never written; corrected 2026-10-07 after the E1 drill. `AlertExceedsMax yes` with pinned scan limits, so an archive clamd declines to scan in full is quarantined rather than reported clean | Phase 4   |
| P-08 | **Audit retention** — how long `audit_events` rows are kept and who may purge them                 | General counsel  | `AGREED` | Audit events are retained **5 years** and may never be purged; after 5 years they are moved to a separate database. Encoded by Wave D: migration `0012` puts triggers on `audit_events` that refuse every `UPDATE`, and refuse `DELETE`/`TRUNCATE` outside the one sanctioned override. `npm run audit:relocate -w @dts/api` moves rows older than five years to `AUDIT_ARCHIVE_DATABASE_URL`, deleting each one only after an identical copy is verified in the archive, whose table is append-only with no override. `audit-relocation.test.ts` fails if any other purge path appears, and `audit-relocation.int.test.ts` proves the move against real Postgres. Procedure: `docs/runbooks/audit-relocation.md`. **Archive host deferred to 2031** (decided 2026-10-06); until it is configured the command refuses to run | Phase 6   |
| P-09 | **Document retention / disposal** — archive period and whether hard deletion is ever permitted      | Records section  | `AGREED` | Soft delete only (`deleted_at`); no hard deletion. The archive is the registry filtered to `ARCHIVED`, reachable from the sidebar by anyone holding `DOCUMENT_ARCHIVE` | Phase 2   |
| P-10 | **Session inactivity timeout**                                                                     | IT security      | `AGREED` | 30 minutes of inactivity (`COOKIE_MAX_AGE_MS` default), renewed on each authenticated request; see [ADR-0002](adr/0002-session-transport.md) | Phase 1   |
| P-11 | **Account provisioning** — who may approve an account request, and whether self-service is allowed  | Admin office     | `AGREED` | Administrator only; no self-service. `account_requests` supports request -> approve/reject and the capabilities are administrator-only, as agreed | Phase 1   |
| P-12 | **Cross-division visibility** — whether any role may read outside its own division                  | Admin office     | `AGREED` | Deny by default; access only via explicit `document_shares` / `document_routes`. Three roles are office-wide by design and named in one place, `OFFICE_WIDE_READ_ROLES`: `ADMINISTRATOR`, `RECORDS_STAFF` and — since ADR-0006 — `DIRECTOR`, which must review any division's work in order to sign it. The confidentiality gate still applies to all three | Phase 1/2 |
| P-13 | **Backup RPO/RTO** — acceptable data loss and restore window for the single-host deployment         | IT operations    | `AGREED` | Recovery point **<= 5 minutes**, restore window **2-4 hours**, archived off-host. Off-host is the office NAS (SMB). Postgres archives WAL continuously (`archive_timeout=60`); `scripts/mirror-objects.sh` mirrors the object store every 3 minutes and `scripts/backup.sh` takes a nightly base; on a Windows host `scripts/push-archive.ps1` copies the archive to the NAS every minute (`docs/runbooks/nas-backup-target.md`). `scripts/restore.sh` replays to a point in time (`docs/runbooks/backup-restore.md`). **Rehearsed 2026-10-06** from the NAS after a host loss: serving in 7 min 33 s, database back to 47 s before the failure, attachments to 3 min 1 s (`docs/evidence/d3-restore-rehearsal.md`) | Phase 7   |
| P-14 | **PII in logs** — which user fields may appear in structured logs                                   | IT security      | `AGREED` | User IDs may be logged; names and emails may not. The logger redacts credential-shaped keys and `key=value` pairs, email addresses anywhere in the text, and `email` / `*Name` fields, error stacks included (D6, `observability.test.ts`) | Phase 0   |
| P-15 | **Release methods** — the ways an outgoing document leaves the office (decision 27, amended 2026-10-06) | Records section  | `AGREED` | Releasing asks two questions: the method — **Mailed, Emailed, Personally delivered, Picked up** (`release_methods`) — and, when Mailed, the carrier — **Postal, LBC or JRS** (`release_carriers`, migration `0013`). Both are configurable rows. `release_methods.requires_carrier` marks Mailed. `release_carriers.requires_tracking_reference` is set for all three, and `WorkflowService` makes the reference mandatory for a flagged carrier and refuses it everywhere else. Releases recorded as `MAILED` before carriers existed have **no carrier**, and the detail page says "not recorded". Records staff fill it in through `POST /documents/:id/release/carrier` (`DOCUMENT_RELEASE_CORRECT`). That correction is audited, only ever replaces a null, and does not demand the tracking reference those releases never had | Phase 7   |

## Changing a row

1. Update the row here with the agreed answer and set `Status: AGREED`.
2. If the decision is architectural, add an ADR under [`adr/`](adr/) and link it.
3. Replace the provisional default in code in the same PR — a register row and the code
   disagreeing is the failure this document exists to prevent.
