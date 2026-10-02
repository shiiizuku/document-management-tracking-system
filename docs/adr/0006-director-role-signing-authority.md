# ADR-0006: Signing authority is its own role, separate from records custody and administration

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering lead, Records section, Office of the Regional Director

## Context

The revised outgoing path splits approval into two acts that bureau practice already treats as
distinct: a division head **initials** a draft (`FOR_INITIAL`), and the Regional Director
**signs** it (`FOR_SIGNATURE` → `SIGNED`).

`DOCUMENT_SIGN` was held by three roles: `RECORDS_STAFF`, `DIVISION_HEAD` and `ADMINISTRATOR`.
Splitting initialling out exposes that none of the three is the right signatory:

- A **division head** signing their own division's output makes `FOR_INITIAL` ceremonial — the
  same person performs both acts, so the two-step approval records nothing the one-step version
  did not.
- **Records staff** are custodians of the record, not signatories to its content. Giving them
  signing authority inverts the control the slip exists to evidence.
- **`ADMINISTRATOR`** is a technical role the model deliberately keeps separate from records
  authority (decision 88: Records Office visibility "is not conflated with unrestricted
  technical administration"). An audit trail reading *"System Administrator signed it"* is not
  evidence of anything, and the seeded administrator account would become the de facto
  signatory in the pilot.

A signature record is tied to a specific immutable file version and is the gate on release
(decision 37). It is the highest-consequence action in the system.

## Decision

**A new `DIRECTOR` role holds `DOCUMENT_SIGN`.** It is a narrow role: signing, plus the read
scope needed to review what it is signing.

`DOCUMENT_SIGN` is **removed from `RECORDS_STAFF` and `DIVISION_HEAD`**.

**A new `DOCUMENT_INITIAL` capability is granted to `DIVISION_HEAD` only.**

`ADMINISTRATOR` retains every capability, as it does today — but it is documented as the
break-glass role, not the intended signatory. Pilot configuration must provision a real
`DIRECTOR` account.

## Consequences

- A sixth value in the `role` pgEnum plus a migration, a `membershipRules` entry in
  [contracts](../../packages/contracts/src/index.ts), and an entry in the third hand-written
  role union in
  [authorization.policy.ts](../../apps/api/src/modules/authorization/authorization.policy.ts).
- **This is a privilege reduction on two live roles.** Existing division-head and records-staff
  accounts lose signing. Any seeded or pilot data that relied on a records account signing must
  be re-cut.
- **No outgoing document can be released until a `DIRECTOR` account exists**, because release is
  gated on a signature record. This is a deployment ordering constraint, not just a
  configuration preference, and belongs in the pilot setup runbook.
- The audit trail now names a person with actual signing authority, which is the point.
- `DIRECTOR` needs office-wide read scope to review documents from any division, which makes it
  the second role after `RECORDS_STAFF` with cross-division visibility. Those two must not be
  collapsed: records staff see everything and sign nothing; the Director sees everything and
  signs.

## Alternatives considered

- **Give the Director an `ADMINISTRATOR` account.** Rejected: conflates signing authority with
  database administration, contradicts decision 88, and makes the audit trail unusable as
  evidence of approval. It also means the person who signs can alter the record of having
  signed.
- **Keep `DOCUMENT_SIGN` on `DIVISION_HEAD`.** Rejected: makes `FOR_INITIAL` and
  `FOR_SIGNATURE` the same person's two clicks, so the split records nothing.
- **A per-user capability override instead of a role.** Rejected for now — it is the more
  flexible model, but the design rule in
  [contracts](../../packages/contracts/src/index.ts) keeps the role→capability map server-side
  and static. If a real person needs a combination no role offers, that is the evidence to
  revisit this; a single known signatory is not.
