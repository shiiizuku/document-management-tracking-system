# ADR-0005: Custody acceptance is a fact on the route, not a workflow status

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering lead, Records section, Office of the Regional Director

## Context

The predefined lifecycle carried a single `PENDING` state, entered once at registration and
left once on `ACCEPT`. The revised core workflow needs an explicit acceptance at **every**
custody hop — the ORD accepts an incoming document, routes it to one or more divisions, each
of which accepts before its sections see it — and the ORD may route to several divisions at
the same time.

One status column cannot hold that. If `PENDING` is re-entered at each hop, a document routed
to three divisions has one status and therefore cannot express "two have accepted, one has
not" — which is the question the system exists to answer.

Two sets of columns were added in the first migration and have never been written by any code
path, anticipating exactly this: `document_routes.completed_at`, and
`document_assignments.division_id` / `section_id`. Routing is currently destructive —
`relocate` overwrites `documents.division_id`, so "forward" means *hand over*, never *copy in*.

## Decision

**Acceptance is recorded on `document_routes`** (`accepted_at`, `accepted_by_id`), not as a
workflow status. The two concerns become orthogonal axes:

- `documents.status` carries the **business lifecycle** (`IN_PROCESS`, `FOR_INITIAL`,
  `FOR_SIGNATURE`, `SIGNED`, `FOR_RELEASE`, `RELEASED`, `COMPLIED`, `ARCHIVED`,
  `FOR_REVISION`).
- `document_routes` carries **custody**: who it was handed to, when they received it, and when
  they passed it on.

**`PENDING` becomes derived**, not stored: a document is pending when it has at least one
unaccepted route row. It is presented as a status to users and filtered on as one; it is not a
column.

**A forward writes one route row per recipient.** Exactly one recipient is the **lead**
(for action, takes custody); the rest are **for information** (`for_information = true`,
read-and-remark only, no workflow actions, division-level only, and attached to the hop that
created them rather than following the document onward). Workflow progress gates on the lead
alone; unaccepted information copies surface as an outstanding acknowledgement, never as a
block.

**`relocate` stops overwriting `documents.division_id` destructively.** Authorization scope
resolves through accepted route rows.

## Consequences

- Every workflow guard, list filter and scope predicate must now consider two axes instead of
  one. Both halves of the deliberately-duplicated authorization layer change together:
  [authorization.policy.ts](../../apps/api/src/modules/authorization/authorization.policy.ts)
  (in-memory) and [query-scope.ts](../../apps/api/src/modules/authorization/query-scope.ts)
  (SQL).
- A derived `PENDING` cannot be indexed as a column. List and dashboard queries need an
  `EXISTS (… WHERE accepted_at IS NULL)` predicate; if measured plans demand it, a maintained
  boolean is the fallback, but the route rows remain the source of truth.
- The routing slip can finally be generated the way the bureau's form is laid out — one row per
  hop with `FROM / DATE-TIME RECEIVED / TO / DATE-TIME RELEASED / ACTION TAKEN`. That layout is
  unimplementable against a single status column, which is a large part of why this decision
  was taken.
- The `ACCEPT` action becomes re-entrant rather than a single `PENDING → IN_PROCESS` edge.
- Illegal-transition tests must grow custody cases: accepting a route you are not the recipient
  of, accepting twice, acting on a document whose lead route is unaccepted, and routing onward
  from a hop you never accepted.
- Documents can be inspected for "who is sitting on this, and since when" without reading the
  audit trail. This is the operational reason the system is being built.

### Correction (2026-10-03, on implementation)

"Authorization scope resolves through accepted route rows", above, is wrong as written, and read
literally it is unimplementable: `ACCEPT` is reached from the document detail view, so a recipient
who cannot read a document could never accept it and the hop would stay outstanding forever. The
rule as built is **scope resolves through route rows; custody gates progress** — any hop addressed
to a unit makes the document readable there, and acceptance governs what may be *done* with it
(`leadRouteOutstanding` in the workflow engine). `RouteRecipient` in `authorization.policy.ts`
deliberately carries no `accepted_at` so the mistaken reading cannot be reintroduced as one
plausible-looking condition.

Two things this decision left open were settled in implementation and recorded as decisions 176
and 177: a unit that forwards a document onward **keeps** it, which makes this a widening rather
than a transfer of access; and a document's location is its most recent *lead* hop, which the
registry filter and the dashboard chart share as one SQL expression.

## Alternatives considered

- **Re-enter `PENDING` as a status at each hop.** Rejected: cannot express partial acceptance
  across parallel recipients, which the multi-division requirement (decision 24) makes
  mandatory. It is also lossy — the document forgets which hop it is pending *at*.
- **A separate `document_custody` table.** Rejected: `document_routes` already is that table,
  already records `from_division_id` / `to_division_id` / `to_section_id` / `routed_by_id`, and
  already carries an unused `completed_at`. A second table would duplicate it and require
  keeping the two consistent.
- **Keep acceptance implicit — treat the first action by a recipient as acceptance.** Rejected:
  the received timestamp is evidence on a printed slip that travels with a physical document.
  Inferring it from unrelated activity makes the slip unreliable, and a document nobody has
  touched yet is indistinguishable from one nobody has *accepted* yet.
