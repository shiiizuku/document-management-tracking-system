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

_Last reviewed: 2026-10-02._

| #    | Policy question                                                                                   | Owner            | Status        | Current behaviour in code                                                                                                      | Blocks    |
| ---- | ------------------------------------------------------------------------------------------------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| P-01 | **Records policy** — which document classes are tracked, and what counts as a complete record      | Records section  | `AGREED` | Tracked classes: incoming, outgoing, FOI, and DENR 8888 Action Center. `DOCUMENT_TYPES` carries all four; the column itself is free text, so that list is the whole of the restriction | Phase 2   |
| P-02 | **Reference-number format** — segments, padding, reset period, per-division vs. global scope        | Records section  | `AGREED` | Confirmed as shipped: `DTS-<year>-<6 digits>` tracking, `<DIVISION>-<year>-<5 digits>` reference, allocated atomically per division and year | Phase 2   |
| P-03 | **Branding** — seal, letterhead, and name block on routing slips and PDF exports                    | Admin office     | `DECIDED` | Assets to be taken from `/public`. `apps/web/public` is currently empty, so the renderers still carry no approved assets | Phase 6   |
| P-04 | **SLA calendar** — working hours, holidays, and what makes a document "overdue"                    | Admin office     | `AGREED` | Overdue is counted in **elapsed calendar days** — no working-hours or holiday calendar. A target date is set per document and pinned to the end of that day, so a document is not overdue on the day it falls due | Phase 5   |
| P-05 | **Signature meaning** — whether the internal signature record is legally sufficient, or a qualified e-signature is required | General counsel  | `AGREED` | The internal signature record is tracking metadata and carries no legal effect; documents are signed outside the system. `signature_events` already records only the internal act | Phase 3/4 |
| P-06 | **File allow-list and size limit**                                                                 | IT security      | `AGREED` | `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, plus `.docx` and `.xlsx`; macro-enabled `.docm`/`.xlsm` refused. Verified by magic bytes. 25 MB ceiling (`UPLOAD_MAX_BYTES`). Preview stays PDF/images, and release requires a PDF or image attachment | Phase 4   |
| P-07 | **Scanner failure posture** — what happens when ClamAV is down or times out                         | IT security      | `AGREED` | **Fail closed** — a version that is not `CLEAN` is never downloadable; bounded retries then `SCAN_FAILED`. `AlertExceedsMax yes` with pinned scan limits, so an archive clamd declines to scan in full is quarantined rather than reported clean | Phase 4   |
| P-08 | **Audit retention** — how long `audit_events` rows are kept and who may purge them                 | General counsel  | `OPEN` | Preserve-by-default, **no automated purge**. Development posture only. A retention period and a purge authority are still required | Phase 6   |
| P-09 | **Document retention / disposal** — archive period and whether hard deletion is ever permitted      | Records section  | `AGREED` | Soft delete only (`deleted_at`); no hard deletion. The archive is the registry filtered to `ARCHIVED`, reachable from the sidebar by anyone holding `DOCUMENT_ARCHIVE` | Phase 2   |
| P-10 | **Session inactivity timeout**                                                                     | IT security      | `AGREED` | 30 minutes of inactivity (`COOKIE_MAX_AGE_MS` default), renewed on each authenticated request; see [ADR-0002](adr/0002-session-transport.md) | Phase 1   |
| P-11 | **Account provisioning** — who may approve an account request, and whether self-service is allowed  | Admin office     | `AGREED` | Administrator only; no self-service. `account_requests` supports request -> approve/reject and the capabilities are administrator-only, as agreed | Phase 1   |
| P-12 | **Cross-division visibility** — whether any role may read outside its own division                  | Admin office     | `AGREED` | Deny by default; access only via explicit `document_shares` / `document_routes` | Phase 1/2 |
| P-13 | **Backup RPO/RTO** — acceptable data loss and restore window for the single-host deployment         | IT operations    | `OPEN` | No recovery point or restore window agreed. Coordinated Postgres + MinIO backup scripts exist, restore unrehearsed. See [ADR-0004](adr/0004-deployment-model.md) | Phase 7   |
| P-14 | **PII in logs** — which user fields may appear in structured logs                                   | IT security      | `AGREED` | User IDs may be logged; names and emails may not. The logger redacts credential-shaped keys and `key=value` pairs | Phase 0   |

## Changing a row

1. Update the row here with the agreed answer and set `Status: AGREED`.
2. If the decision is architectural, add an ADR under [`adr/`](adr/) and link it.
3. Replace the provisional default in code in the same PR — a register row and the code
   disagreeing is the failure this document exists to prevent.
