# Policy register

Every policy question that changes **system behaviour** and is owned by the institution
rather than by engineering. A question is listed here the moment code needs an answer, so
that no placeholder heuristic silently becomes permanent behaviour.

**Status values**

- `OPEN` — no decision; code carries a documented provisional default.
- `PROVISIONAL` — engineering chose a defensible default to stay unblocked; the owner has
  not confirmed it.
- `AGREED` — the owner confirmed it and the code matches.

Provisional defaults are **dev/pilot-only**. `OPEN` and `PROVISIONAL` rows must all reach
`AGREED` before the Phase 7 readiness sign-off.

_Last reviewed: 2026-09-28._

| #    | Policy question                                                                                   | Owner            | Status        | Current behaviour in code                                                                                                      | Blocks    |
| ---- | ------------------------------------------------------------------------------------------------- | ---------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------- |
| P-01 | **Records policy** — which document classes are tracked, and what counts as a complete record      | Records section  | `OPEN`        | Enum `document_direction` + free-text `type`; no class restriction enforced                                                     | Phase 2   |
| P-02 | **Reference-number format** — segments, padding, reset period, per-division vs. global scope        | Records section  | `OPEN`        | `reference_counters (division_id, scope_key, next_value)` can express most formats; the rendered string is not yet fixed        | Phase 2   |
| P-03 | **Branding** — seal, letterhead, and name block on routing slips and PDF exports                    | Admin office     | `OPEN`        | Routing-slip and report renderers accept a branding config; no assets supplied                                                 | Phase 6   |
| P-04 | **SLA calendar** — working hours, holidays, and what makes a document "overdue"                    | Admin office     | `OPEN`        | No overdue computation; the dashboard's overdue highlighting is unimplemented                                                  | Phase 5   |
| P-05 | **Signature meaning** — whether the internal signature record is legally sufficient, or a qualified e-signature is required | General counsel  | `OPEN`        | `signature_events` records an internal act only; release requires a signature + a CLEAN attachment                             | Phase 3/4 |
| P-06 | **File allow-list and size limit**                                                                 | IT security      | `PROVISIONAL` | `application/pdf`, `image/png`, `image/jpeg`, `image/webp`, verified by magic bytes; 25 MB ceiling (`UPLOAD_MAX_BYTES`)        | Phase 4   |
| P-07 | **Scanner failure posture** — what happens when ClamAV is down or times out                         | IT security      | `PROVISIONAL` | **Fail closed** — a version that is not `CLEAN` is never downloadable; bounded retries then `SCAN_FAILED`                      | Phase 4   |
| P-08 | **Audit retention** — how long `audit_events` rows are kept and who may purge them                 | General counsel  | `OPEN`        | Preserve-by-default, **no automated purge**. Development posture only                                                          | Phase 6   |
| P-09 | **Document retention / disposal** — archive period and whether hard deletion is ever permitted      | Records section  | `OPEN`        | Soft delete only (`deleted_at`); no disposal path exists                                                                       | Phase 2   |
| P-10 | **Session inactivity timeout**                                                                     | IT security      | `PROVISIONAL` | 30 minutes (`COOKIE_MAX_AGE_MS` default); see [ADR-0002](adr/0002-session-transport.md)                                        | Phase 1   |
| P-11 | **Account provisioning** — who may approve an account request, and whether self-service is allowed  | Admin office     | `OPEN`        | `account_requests` supports request → approve/reject; the approver role is not yet fixed                                        | Phase 1   |
| P-12 | **Cross-division visibility** — whether any role may read outside its own division                  | Admin office     | `PROVISIONAL` | Deny by default; access only via explicit `document_shares` / `document_routes`                                                | Phase 1/2 |
| P-13 | **Backup RPO/RTO** — acceptable data loss and restore window for the single-host deployment         | IT operations    | `OPEN`        | No schedule agreed; coordinated Postgres + MinIO backup scripts exist, restore unrehearsed. See [ADR-0004](adr/0004-deployment-model.md) | Phase 7   |
| P-14 | **PII in logs** — which user fields may appear in structured logs                                   | IT security      | `PROVISIONAL` | Logger redacts credential-shaped keys and `key=value` pairs; user IDs are logged, names and emails are not                     | Phase 0   |

## Changing a row

1. Update the row here with the agreed answer and set `Status: AGREED`.
2. If the decision is architectural, add an ADR under [`adr/`](adr/) and link it.
3. Replace the provisional default in code in the same PR — a register row and the code
   disagreeing is the failure this document exists to prevent.
