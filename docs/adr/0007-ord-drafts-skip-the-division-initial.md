# ADR-0007: Outgoing correspondence drafted in the ORD is signed without a separate initial

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering lead, Records section, Office of the Regional Director

## Context

[ADR-0006](0006-director-role-signing-authority.md) split approval into two acts by two
authorities: a division head **initials** an outgoing draft (`FOR_INITIAL`), and the Regional
Director **signs** it (`FOR_SIGNATURE` → `SIGNED`). It removed `DOCUMENT_SIGN` from `DIVISION_HEAD`
with an explicit reason — *"a division head signing their own division's output makes `FOR_INITIAL`
ceremonial — the same person performs both acts, so the two-step approval records nothing the
one-step version did not."*

Implementing that exposed a case the ADR did not consider. The Office of the Regional Director is
itself modelled as a Division (decision 152) and registers outgoing correspondence of its own,
which carries `ORD-<year>-<sequence>` (decision 153). The ORD's division head **is** the Regional
Director.

So an ORD-drafted outgoing document, under a uniform reading of decision 161, would be initialled
and signed by the same person — exactly the arrangement ADR-0006 rejected, reintroduced through the
organization structure rather than through the capability map.

Three ways out were available: give the ORD a non-Director division head, have the Records Unit
endorse ORD drafts, or exempt ORD drafts from `FOR_INITIAL`.

## Decision

**`IN_PROCESS → FOR_SIGNATURE` is legal for outgoing documents owned by the ORD, and
`IN_PROCESS → FOR_INITIAL` for every other division.** An ORD draft goes straight to the Director.

The rule lives in one named map in
[workflow.service.ts](../../apps/api/src/modules/workflow/workflow.service.ts) (`edgeConditions`),
keyed by `status:action`, rather than as a branch inside `execute`: the transition table stays the
only decider of what is *reachable*, and that map is the only place a reachable edge is withheld.
`WorkflowDocument` carries `ownerDivisionIsOrd`, resolved by the caller, so the engine stays a pure
function of its inputs.

The ORD is identified **by division code**, `ORD`
([organization.constants.ts](../../apps/api/src/modules/organization/organization.constants.ts)),
because the id differs per environment and the pilot's ORD row is created by configuration rather
than by a migration.

## Consequences

- An outgoing document drafted in the ORD records one approval, not two. That is honest: there is
  one authority in the ORD who can approve its content, and the system now says so rather than
  collecting the same signature twice under two names.
- **Every other division's outgoing correspondence cannot reach signature without its head's
  initial.** With `DOCUMENT_INITIAL` held only by `DIVISION_HEAD`, a division whose head's account
  is missing or deactivated cannot release outgoing correspondence at all. That is the intended
  control, and it is a pilot-setup requirement alongside ADR-0006's `DIRECTOR` account.
- The transition table is no longer a pure function of `(direction, status, action)`. It is a
  function of those plus one documented document fact. Any further conditional edge should be
  weighed against collapsing this into a general guard mechanism; one exception does not justify
  one.
- **A deployment where no division is coded `ORD` is safe but stricter**: nothing is exempt, so
  every outgoing draft requires an initial. The failure mode of a misconfigured ORD code is a
  blocked document, never an unapproved one.
- Decision 161 reads as universal and now has an exception. It carries an amendment note in
  `docs/CONTEXT.md` pointing here.

## Alternatives considered

- **Give the ORD a non-Director division head** (for example a Chief Administrative Officer who
  holds `DOCUMENT_INITIAL`). Rejected for now, though it is the better long-run answer: it keeps
  the state machine uniform and makes the two-person rule a fact of the organization chart rather
  than a branch in code. It was not chosen because it asserts a post the office has not confirmed
  exists, and inventing an approver to keep a diagram tidy is how a control becomes a formality. If
  the Records Unit confirms such a post, this ADR should be superseded and the exemption deleted.
- **Have the Records Unit section chief endorse ORD drafts.** Rejected: it contradicts ADR-0006's
  reasoning directly — records staff are custodians of the record, not signatories to its content,
  and giving them an approval role over content inverts the control the routing slip exists to
  evidence.
- **Require the initial anyway and let the Director perform both acts.** Rejected: it is the status
  quo ADR-0006 removed, and it makes the timeline claim a two-person review that never happened.
  An audit trail that records a fiction is worse than one that records a single approval.
