# DTS — Coding Breakdown by Phase

Companion to `dts-developer-assignment.md`. This version is written the way a developer works: **repo layout → schema → endpoints → task order → tests → PR slices → done-when.**

> Names below (folders, tables, files) are **suggested conventions** derived from the plan's module boundaries, ER model, and endpoint list. Adjust to repo standards, but keep the module boundaries (Identity, Authorization, Organization, Documents, Workflow, Routing, Files, Notifications, Reports, Audit, Outbox/Jobs).

---

## Core workflow revision (2026-10-02)

The revision recorded in `CONTEXT.md` (decisions 152–175) and ADR-0005/0006/0007 is being delivered
as six dependency-ordered slices. **Slices 1–3 are done**; the rest are not started.

| Slice | Work | Status |
| ----- | ---- | ------ |
| 1 | Migration `0005` (custody columns on `document_routes`, derived `PENDING`, enum replacement) + one status vocabulary in `@dts/contracts` | ✅ done |
| 2 | Workflow engine: `FOR_INITIAL`, `COMPLIED`, direction-branched matrix and `RESTORE`, re-entrant `ACCEPT` | ✅ done |
| 3 | `DIRECTOR` role; remove `DOCUMENT_SIGN` from `RECORDS_STAFF` and `DIVISION_HEAD` | ✅ done |
| 4 | Non-destructive routing: `relocate` must stop overwriting `documents.division_id`; scope resolves through accepted routes; multi-recipient forwards write `for_information` rows | ✅ done |
| 5 | Reference Document join table (decisions 165–167) | ⬜ not started |
| 6 | UI: detail-view right rail, reference-document modal, inline routing slip, list-view control, Inter | ⬜ not started |

**What slices 1–3 changed that later slices inherit**

- `documents.status` no longer holds `PENDING`; the enum type was replaced. `PENDING` is derived
  from unaccepted `document_routes` rows through one predicate, `documentIsPending` in
  `modules/authorization/query-scope.ts` — the registry filter, the dashboard tiles and
  `pendingByDivision` all compose it. Any new list or report must too.
- `@dts/contracts` is the single source for the status vocabulary. The database `pgEnum` and
  `WorkflowService` both derive from it; `storedWorkflowStatusSchema` is the presented set minus
  `PENDING`. A new status is added there and nowhere else.
- `workflow_events.from_status` / `to_status` are `varchar`, not the enum: the timeline keeps the
  vocabulary each row was written in, so pre-revision hops still read `PENDING`.
- Registration writes an unaccepted route row (decision 154), so **`document_routes` is now custody
  history, not a log of forwards** — code that assumed one row per forward needs checking.
- `ACCEPT` does not bump `documents.version`; it stamps a route row under an
  `accepted_at IS NULL` conditional update. Double acceptance is `422 ROUTE_ALREADY_ACCEPTED`, not
  a version conflict.
- `DOCUMENT_SIGN` is held by `DIRECTOR` and, as break-glass only, `ADMINISTRATOR`. Records staff
  and division heads no longer sign. Any new test or fixture that drives the outgoing path past
  `FOR_SIGNATURE` needs a Director actor for that one step.
- Office-wide read is now a named set, `OFFICE_WIDE_READ_ROLES` in `authorization.policy.ts`, shared
  by `canRead` and its SQL twin `documentScopeFor`. `DIRECTOR` is in it *and* is placed in a
  division, so no scope code may infer "reads everything" from an absent `divisionId` any more.

**Known gaps carried forward**

- The seed now creates an `ORD` division alongside `RECORDS` / `PILOT`, so a division *is* the ORD
  and ADR-0007's exemption is reachable. The other half of decision 152 is still owed: the Records
  Unit should be a Section **inside** the ORD rather than its own `RECORDS` division. Until that
  lands the seeded records officer sits outside the ORD, so drafts it registers take the ordinary
  `FOR_INITIAL` path.
- `director@dts.local` is seeded with a development password. Pilot configuration must replace it
  with a real account for the Regional Director — ADR-0006 makes the existence of that account a
  deployment-ordering constraint, because release is gated on a signature nobody else may make.
- Release methods are still a database enum. Decision 27 as amended calls for configurable rows
  seeded with Emailed / Postal / LBC / JRS / Picked Up / Personally Delivered.

### Slice 3 plan — the `DIRECTOR` role

Planned 2026-10-02 for the next session. Implements ADR-0006. **This is a privilege reduction on
two live roles**, so the order below matters: the role and its account must exist before signing is
taken away from anyone, or outgoing correspondence becomes unsignable between two commits.

**Why it is not just a table edit.** `DIRECTOR` is the first role that is *placed in a division yet
reads the whole office*. Today placement narrows scope and the two roles with office-wide read
(`ADMINISTRATOR`, `RECORDS_STAFF`) are the two whose placement is optional. The Director is placed
in the ORD — ADR-0006 — and must still review any division's work in order to sign it. That breaks
the implicit rule in both halves of the authorization layer, which is the real work of this slice.

**Steps, in order**

1. **Vocabulary and schema.** Add `DIRECTOR` to `roleSchema`
   (`packages/contracts/src/index.ts`) and to the `role` pgEnum (`apps/api/src/database/schema.ts`,
   derived by hand here — unlike the status enum, the role enum is still written out). Migration is
   `ALTER TYPE "role" ADD VALUE 'DIRECTOR'`, which is additive and needs no backfill. Note that
   Postgres will not let a newly added enum value be *used* in the same transaction that adds it,
   so the seed must not run in that migration.
2. **Membership rules.** `membershipRules` in `packages/contracts/src/index.ts` requires a division
   for every role except `ADMINISTRATOR` and `RECORDS_STAFF`; `DIRECTOR` keeps that requirement
   (it belongs to the ORD) and must **not** require a section. The same predicate is duplicated
   server-side at `organization.service.ts:167` and in the web at `users-screen.tsx:90` and
   `account-requests-screen.tsx:277` — all four change together or the form and the API disagree
   about whether a Director needs a section.
3. **Read scope — both halves together.** `AuthorizationPolicy.canRead`
   (`authorization.policy.ts`) and its SQL twin `documentScopeFor` (`query-scope.ts`) each
   special-case `ADMINISTRATOR || RECORDS_STAFF` for office-wide read. `DIRECTOR` joins that branch
   **without** losing the confidentiality gate. ADR-0006 is explicit that records staff and the
   Director must not be collapsed: records staff see everything and sign nothing, the Director sees
   everything and signs.
4. **Capabilities.** Add a `DIRECTOR` entry to `capabilitiesByRole`
   (`role-capabilities.ts`) holding `DOCUMENT_SIGN` plus `REPORT_VIEW` — narrow by design. It does
   **not** get `DOCUMENT_INITIAL`: initialling belongs to division heads, and under ADR-0007 an ORD
   draft skips `FOR_INITIAL` entirely, so the Director never needs it.
5. **Then remove `DOCUMENT_SIGN` from `RECORDS_STAFF` and `DIVISION_HEAD`.** Only after 1–4 and the
   seeded account in 6 exist.
6. **Seed a Director.** `apps/api/src/database/seed.ts` gains a `director@dts.local` account in the
   ORD division. ADR-0006 makes this a deployment-ordering constraint, not a convenience: release
   is gated on a signature record, so **no outgoing document can be released until a `DIRECTOR`
   account exists**. This is coupled to the decision-152 org restructure — the ORD division itself
   does not exist in the seed yet — so the two may be worth doing in one pass.
7. **`user:read` for the Director?** Open question, not a blocker. `UserPolicy`
   (`identity.policies.ts:37`) lets a `DIVISION_HEAD` read its own division's users so it can pick
   assignees. The Director signs documents rather than assigning them, so the default of "needs
   `USER_MANAGE`" is probably right — but the timeline and signature panels display actor names,
   so check whether those resolve names through an endpoint the Director may not call.

**Tests that will fail and are supposed to**

- `role-capabilities.test.ts` asserts every contract capability is granted to at least one role —
  it will pass only once `DIRECTOR` holds `DOCUMENT_SIGN`, which is the point.
- `authorization.service.test.ts:13` hard-codes the five-role list for its matrix sweep; add
  `DIRECTOR` there so the matrix actually covers it.
- `query-scope.int.test.ts` should gain a Director case asserting office-wide read *and* that the
  confidentiality gate still applies — the same shape as the existing records-staff case.
- **Every test that signs as records staff breaks**: `files.int.test.ts` (whose fixture user is
  `RECORDS_STAFF` in the ORD-coded division) and `file-api.test.ts` (`records@dts.local`). These
  need a Director actor to perform `SIGN`, which is the clearest evidence the privilege reduction
  actually took effect.
- The web role pickers derive from `roleSchema.options`, so `DIRECTOR` appears in the admin forms
  with no UI change. `apps/web/test/fixtures.ts` and `session.test.tsx` pin `RECORDS_STAFF` and are
  unaffected.

**Done when:** a Director account signs an outgoing document end to end; records staff and division
heads are refused `SIGN` with a 403 and a negative test proves it; the authorization matrix passes
for six roles; and the Director can read another division's document but not a confidential one.

**Outcome (2026-10-03).** All six steps landed; migration `0006_director_role.sql` adds the enum
value. Two things in the plan above turned out not to need code:

- **Step 2 was already satisfied.** All four copies of the membership predicate are written as
  "every role except `ADMINISTRATOR` and `RECORDS_STAFF` needs a division; `STAFF_MEMBER` and
  `VIEWER` need a section", which gives `DIRECTOR` exactly the intended answer — division yes,
  section no — with no clause added. Only the comments changed, to say that this is deliberate
  rather than accidental.
- **Step 7 is settled: the Director does not need `user:read`.** The timeline and signature panels
  resolve actor names through a join inside the scoped document query
  (`documents.repository.ts`), not through `/users`, so office-wide document read is enough.
  `authorization.service.test.ts` pins the refusal so the next missing-name bug is not "fixed" by
  widening the people policy.

### Slice 4 plan — non-destructive routing

Planned 2026-10-03 for the next session. Completes the second half of ADR-0005: the half that
decision 157 and slice 1 already *assumed*. **This is the slice that changes what a column means**,
so it is the one most able to break reads silently rather than loudly.

**Why it is not just deleting an `UPDATE`.** `relocate` does not merely label a document —
`documents.division_id` *is* the authorization scope. Both halves of the authorization layer resolve
a section actor's read through `documents.division_id = actor.divisionId` and nothing else
(`query-scope.ts:50-55`, `authorization.policy.ts` `canRead`). Stop writing that column and every
non-office-wide reader loses the document the moment it is forwarded to them: the receiving division
is named only on a `document_routes` row nobody consults for scope. So the `UPDATE` cannot be
removed before the route-derived predicate replaces it, in both halves, in that order.

**What the column will mean afterwards.** `documents.division_id` / `section_id` become the
**registering placement** — where the document entered the office — and are immutable after
creation. They are not a denormalised "current holder": a maintained copy would need the same
two-axis logic to compute and would be one more thing to drift. This reading is already the one the
rest of the code wants:

- `isOrdDivision(row.divisionId)` (ADR-0007) asks where an outgoing document was *drafted*. Under a
  moving column that answer silently changes on the first forward; under an immutable one it is
  right for good.
- The division code embedded in the reference number (decision 153) is the registering division's.
  Today a forwarded `ORD-2026-0001` reports a `division_id` its own tracking number contradicts.

A rename is deliberately *not* proposed: `documents_scope_status_idx` and nine call sites would
churn for a comment. The column keeps its name and gains a doc comment saying it is origin, not
custody.

**The contradiction in ADR-0005 that has to be resolved first.** The ADR says "authorization scope
resolves through accepted route rows". Taken literally that is unimplementable: a recipient cannot
accept a document it cannot read, and `ACCEPT` is reachable only from the detail view, which goes
through `findReadableById`. Scope must therefore resolve through **any** route row addressed to the
actor's unit, accepted or not; **acceptance gates actions, not visibility**, which is what slice 2
already built (`leadRouteOutstanding`). Read as "scope resolves through route rows; custody gates
progress" the ADR is consistent and needs no amendment — but the sentence is worth a correction note
in its consequences, because the literal reading is a plausible and broken implementation.

**The second question the ADR leaves open: does a division that forwarded a document onward keep
it?** Recommended answer: **yes**. Non-destructive means nobody loses what they held — the unit that
handled a document can still answer for it, which is the operational reason the slip exists. The cost
is honest and should be written down: this is a **widening**. Today forwarding revokes the sender's
read; afterwards read accumulates along the custody chain. Decide it explicitly, record it as a new
decision, and pin it with a test either way, because "the division that passed it on can still read
it" is exactly the sort of thing that looks like a leak to whoever finds it later.

**Steps, in order**

1. **The route-scope predicate, added alongside the column check, not replacing it.** A new
   `documentReachableByRoute(actor)` in `query-scope.ts` — an `EXISTS` over `document_routes` where
   `to_division_id = actor.divisionId` and (`to_section_id IS NULL` for a division-level actor, or
   `to_section_id = actor.sectionId`). Compose it into the `reachable` array next to the existing
   `eq(documents.divisionId, ...)` branch. At this step both predicates are live, so the change is a
   pure widening and nothing can break; the column check comes out in step 4.
2. **The in-memory twin, same shape.** `AuthorizationResource` gains a `routes` field (the
   `{ toDivisionId, toSectionId, forInformation }` triple is enough — `canRead` must not look at
   `acceptedAt`, per the resolution above) and `canRead` gains the matching branch. Then fix
   `asResource` (`documents.service.ts:1113`), which today passes `assigneeUserIds: []` and
   `sharedUserIds: []` — harmless while the division check carried every case, a false 403 the
   moment it does not. Every `can(...)` call site on the capability path needs the routes loaded;
   `requireReadable` already has the row, so the cheapest correct shape is a
   `requireReadableWithRoutes` used by `route`, `share`, `assign` and the workflow commands.
   `query-scope.test.ts` and `query-scope.int.test.ts` exist precisely so these two halves can be
   asserted to agree — add the route cases to both in this step, not later.
3. **Multi-recipient forwards.** `routeDocumentSchema` gains
   `forInformationDivisionIds: z.array(z.uuid()).max(…).optional()` — division-level only
   (decision 160), so no section ids and no nesting. Validate server-side that the list is distinct,
   excludes the lead, and that each division resolves and is active, reusing `resolvePlacement`.
   `route()` then writes one lead row (`for_information: false`, as now) plus one row per
   information recipient inside the same transaction, with `from_division_id` set to the **current
   custody division** — not `current.divisionId`, which is about to stop meaning that. One
   `document.routed` audit event carrying the recipient list, not one per row: the forward is the
   act. Notification rows for the information recipients belong here too, in the same transaction,
   per the global convention.
4. **Then stop writing the column.** `relocate` loses its `divisionId` / `sectionId` `set` and
   becomes what it actually is — a conditional version bump — so rename it
   `bumpVersion(id, expectedVersion, tx)`. Keep the bump: unlike `ACCEPT` (which stamps a route row
   and deliberately does not bump), a forward must not race another forward, and `expectedVersion`
   is the client's only guard. The `ROUTE_NO_OP` check must at the same moment compare the
   destination against the **current custody hop** rather than `current.divisionId`, or forwarding a
   document back to the division that registered it starts failing as a no-op.
5. **Migration `0007`.** Add `document_routes_recipient_idx` on
   `(to_division_id, to_section_id, document_id)` to back the new `EXISTS` — the existing index is
   partial on unaccepted rows and will not serve a predicate that ignores `accepted_at`. Leave
   `documents_scope_status_idx` in place; origin + status is still what the registry filters on. No
   backfill: pre-slice-4 documents already have route rows for every hop, which is exactly why this
   is doable without one.
6. **Decide what the registry's division filter means** (`documents.repository.ts:314`) and say so in
   the UI. It currently filters `documents.division_id`, which after step 4 reads "registered by",
   while a user picking a division in the registry almost certainly means "currently with". These
   are now two different questions and the filter can only answer one. Recommended: keep the filter
   on origin (it is the cheap indexed one, and it matches the reference number the row displays) and
   relabel the control; a custody filter is a separate, route-joined query best added with the
   slice 6 list work rather than smuggled in here.
7. **`pendingByDivision` groups by the wrong column** (`documents.repository.ts:712-728`). It joins
   `divisions` on `documents.division_id`, so after step 4 the dashboard tile reads "pending by
   registering division" — which for incoming correspondence is the ORD, every time, making the tile
   useless at exactly the thing it is for. Regroup it on the unaccepted route's `to_division_id`,
   which is the division actually sitting on the work. `dashboard.int.test.ts` will need its
   expectation rewritten and should gain a forwarded-document case.

**Tests that will fail and are supposed to**

- `query-scope.test.ts` / `query-scope.int.test.ts` — the point of the slice. Needs: a section actor
  reading a document forwarded to its section but registered elsewhere; the same actor **not**
  reading one forwarded to a sibling section; a division-level actor reading a division-level
  for-information row; and the confidentiality gate still refusing all of them.
- `documents.int.test.ts` — any assertion that `division_id` changed after a forward now asserts the
  opposite. These are the loudest and most useful failures in the slice; rewrite them to assert the
  route row instead.
- `dashboard.int.test.ts` — see step 7.
- `in-memory-documents.repository.ts` — the test double has to grow the same route-reachability
  logic, or unit tests will disagree with Postgres about who can read what.
- `workflow.test.ts` should be unaffected: slice 2 already branches on `forInformation`, and this
  slice only starts *writing* rows that set it. If it does break, the engine was reading custody from
  the document rather than from the routes, which is worth knowing.

**Deliberately out of scope**

- **A standalone remark action for for-information recipients.** Decision 160 says read *and*
  remark; there is no `REMARK` in `workflowActions` and no vocabulary for a remark that is not a
  transition. Writing the rows is what ADR-0005 requires of this slice; the remark surface is
  UI-shaped and belongs with slice 6 — but it is an owed obligation, not a dropped one.
- **Decision 158's combined accept-and-route action.** One user action, two audit events, so the
  slip can show received *and* released. The endpoints are separate today; merging them is a
  UI-driven change and depends on step 3 existing first.

**Done when:** a document registered in the ORD and forwarded to a division's section is readable by
that section's staff and by the division head, before and after acceptance, while
`documents.division_id` still names the ORD; a forward naming two information recipients writes three
route rows and progresses on the lead alone; the sender's own read after forwarding matches whatever
was decided above and a test pins it; `pendingByDivision` attributes a forwarded document to the
division holding it; and the in-memory policy and the SQL predicate agree on every fixture in
`query-scope.int.test.ts`.

**Outcome (2026-10-03).** All seven steps landed; migration `0007_non_destructive_routing.sql` adds
`document_routes_recipient_idx`. Both open questions were answered as recommended — scope resolves
through *any* hop addressed to the actor's unit, and a unit that forwards a document onward keeps it
(recorded as decision 176). Four things differ from the plan above:

- **Step 6 was decided the other way.** The plan recommended leaving the registry's division filter
  on origin. That breaks the dashboard: `dashboard.int.test.ts` calls it "the acceptance condition
  for this change" that every division tile equals what the registry returns for the same division
  as the same user, and a tile grouped by custody beside a list filtered by origin disagrees with
  itself the first time anything is forwarded. So both now compose one shared expression,
  `custodyDivisionId` in `query-scope.ts`, and the filter's label became **Currently with**.
- **Custody is the lead hop, not every unaccepted one.** Step 7 first grouped by each unaccepted
  recipient, which counts a document once per division holding a copy. A forward names exactly one
  lead recipient (decision 159) and copies for information are never work in hand (decision 160), so
  custody is single-valued — which is also what lets the chart and the list reconcile exactly.
- **`ReportDocument` stopped extending `AuthorizationResource`.** Making `routes` required exposed
  it as the last trace of the deleted second authorization pass that `monthly-report.ts` already
  warns about: nothing re-checks readability on a report row, and the interface was contributing two
  stub arrays the client never expected. It now declares its own fields, and the served payload
  matches the web's `ReportDocument` exactly.
- **`asResource` no longer stubs assignment and share membership.** It passed empty arrays on the
  reasoning that a row already proven readable in SQL needed only its own columns. That was a false
  403 waiting to happen even before this slice; with placement resolving through hops it would have
  been one on every forwarded document. `DocumentsRepository.authorizationFacts` loads hops,
  assignees and sharees in three queries, batched over ids so `deletedQueue` cannot become N round
  trips.

Two notes for the next session:

- **The integration suite caught a bug no unit test could.** Drizzle qualifies an interpolated
  column only inside a *nested* `sql` chunk, so the `EXISTS` written directly into
  `custodySectionId` rendered `${documents.id}` as a bare `"id"`, which inside the subquery resolved
  to `lead_hop.id` — a condition that is always false, making every document report its registering
  section as its custody section. It is now the named `anyLeadHop` fragment, and the comment there
  says why.
- **`notifications.int.test.ts` has one failing test and it is not this slice's.** "publishes
  committed outbox events onto the queue exactly once" fails identically on a clean checkout of
  `feat/director-role`; verified by stashing. Worth its own look.


### Slice 5 plan — Reference Documents

Planned 2026-10-03 for the next session. Implements decisions 165–167. The join table is half an
hour's work; **decision 166 is the slice** — "a reference the reader may not read is
indistinguishable from one that does not exist" is a statement about error messages and payload
shapes, and it is broken by the obvious implementation of every endpoint below.

**Three things are already called "reference", and this is a fourth.** `documents.reference_number`
is the organization's identifier for an *outgoing* document; the sender's reference number is free
text on an *incoming* one; both are strings. A Reference Document is a **relationship**
(`CONTEXT.md` glossary). Nothing in this slice may be named `reference` unqualified — and SQL
settles it anyway, since `REFERENCES` is a reserved word and a column of that name would need
quoting everywhere. Use `document_references` for the table, and in payloads name the two
directions for what they are: `referencedDocumentIds` on the outgoing side, `replyDocumentIds` on
the incoming one.

**The relation is directional and that buys a guarantee.** An outgoing document names incoming
documents; the inverse is read from the incoming side as its replies (decision 165). Enforcing
direction therefore makes cycles unrepresentable — an incoming document can never be the naming
side — so no cycle check, depth limit or recursive guard is needed anywhere. Say so in the schema
comment, or someone will add one later for safety.

**Steps, in order**

1. **Migration `0008` and the table.** `document_references`:
   `outgoing_document_id` / `incoming_document_id` (both FK to `documents`, both `NOT NULL`),
   `created_by_id`, `created_at`. Composite unique on the pair — that is what makes linking
   idempotent rather than requiring a read-before-write — plus an index on
   `incoming_document_id` for the reverse read, which is the half a composite key does not serve.
   Direction (`outgoing` is `OUTGOING`, `incoming` is `INCOMING`) cannot be a column constraint
   without a trigger, so it is a service-level check with a schema comment saying where the rule
   actually lives. A `CHECK (outgoing_document_id <> incoming_document_id)` is still worth having:
   it costs nothing and self-reference is the one malformed row the direction rule would not catch
   if the direction check were ever bypassed.
2. **Contracts.** `linkReferenceDocumentSchema` = `{ incomingDocumentId: z.uuid() }`. Deliberately
   one id per call rather than a set: a batch endpoint has to decide what happens when three ids
   are valid and the fourth is unreadable, and under decision 166 every answer to that leaks —
   partial success tells the caller which id was the bad one. One id per call, each with the same
   indistinguishable 404, has no such seam. The UI loops.
3. **Read scope, both directions.** `getDocument` gains `referencedDocuments` (outgoing side) and
   `replyDocuments` (incoming side), each a list of summaries — tracking number, title, direction,
   status, `createdAt` — resolved in **one** scoped query per direction: `inArray` over the joined
   ids, `and(isNull(documents.deletedAt), documentScopeFor(actor))`. Not a loop of
   `findReadableById`, both for the round trips and because a loop invites a
   "`null` for the ones you can't see" placeholder, which is exactly the leak decision 166
   forbids. **A reference the reader cannot read is absent, not nulled, not counted.** Two readers
   seeing different lengths for the same document is the intended behaviour, not a bug to
   reconcile.
4. **Then the write path, which is where the leak actually happens.** `POST
   /documents/:id/references` must return the *same* `404 Document not found` for an
   `incomingDocumentId` that does not exist, is soft-deleted, is confidential and the author is not
   cleared, or sits outside the author's scope. A `403` on the last of those — the natural thing to
   write, and what the capability helpers would give you — turns the endpoint into an existence
   oracle: it answers "this id is real and you may not see it", which is the one thing the decision
   says must be unanswerable. So the referenced document is loaded with
   `requireReadableDocument`, whose miss is already a 404, and no capability check is run against
   it at all. The author's own `DOCUMENT_EDIT` on the *outgoing* document is the authorization;
   readability of the target is a precondition, not a permission.
5. **`DELETE /documents/:id/references/:incomingDocumentId`** has the same shape and the same trap:
   deleting a link whose target you cannot read must 404 identically to deleting a link that was
   never there. The delete is therefore `DELETE … WHERE` both ids match **and** the target is
   readable, and a zero-row result is a 404 — not a lookup followed by a permission check.
6. **Freeze and capability — decision 178.** Linking is gated by `requireEditableDocument` on the
   outgoing document, which already refuses `RELEASED` and `ARCHIVED` and already enforces
   `DOCUMENT_EDIT`, so the reference set is **immutable once the letter goes out**: a reference
   added afterwards would rewrite the record of a document already sent. Note the consequence the
   decision carries — the UI must offer linking before `PREPARE_RELEASE`, because after it there is
   no path at all.
7. **Audit, no version bump — decision 179.** `document.reference-linked` /
   `document.reference-unlinked` audit and outbox rows in one transaction, per the global
   convention. No `expectedVersion` and no bump to `documents.version`: nothing on the document row
   changes, the unique pair makes the write idempotent, and bumping would invalidate every open form
   on a document because someone attached a reply to it. Same reasoning as `ACCEPT`, which stamps a
   route row and leaves the document untouched. The insert is `ON CONFLICT DO NOTHING` returning
   whether a row appeared, so a double submit is a quiet success rather than a 409 — and so the
   audit trail does not grow a second identical event.

**Deliberately out of scope**

- **Decision 167's modal** — the referenced record and its attachments with inline preview. That is
  slice 6, and it needs no new API: `/documents/:id` and `/documents/:id/attachments` are both
  already scoped through `requireReadableDocument`, so a reference the reader may open resolves
  through the endpoints that exist. Confirmed rather than assumed, because "the modal needs its own
  endpoint" would be the natural guess.
- **Any workflow coupling.** The glossary is explicit that linking a reply is *evidence* of
  compliance and not the act of it — some incoming documents need no reply and some need several.
  Linking must not trigger, suggest or unblock `COMPLY`, and a test should pin that the status does
  not move.
- **References on the routing slip.** The bureau form (decision 171) has no row for them.
- **Setting references at registration.** `createDocumentSchema` stays untouched. Folding them into
  the create transaction means the direction check runs against a document that does not exist yet
  and the first metadata revision has to describe a relation, for no gain: the UI can link straight
  after creating.

**Tests that will matter**

- **The indistinguishability pair, twice.** Linking a nonexistent id and linking a real id outside
  the author's scope must produce byte-identical responses; same for the two deletes. Assert the
  bodies are equal to each other, not merely that both are 404 — the status is the easy half and
  the message is where the leak reappears.
- **Confidentiality.** An outgoing document that references a confidential incoming one: a cleared
  reader sees the reference, an uncleared reader sees a list with one fewer entry and no indication
  anything was removed.
- **Both directions through scope**, in `query-scope.int.test.ts`'s idiom: the reply list on the
  incoming side is filtered by the same predicate as the reference list on the outgoing side, so a
  reader who may see the letter but not the reply sees no reply.
- **Direction and self-reference refusals**: outgoing→outgoing, incoming→anything, and a document
  naming itself.
- **Idempotence**: linking the same pair twice is one row, one audit event, and not a 409.
- **The freeze**: linking on a `RELEASED` outgoing document is refused by the existing rule.
- `in-memory-documents.repository.ts` needs the join and both scoped reads, or the REST suites will
  disagree with Postgres about which references exist — the same parity obligation slice 4 had.

**Done when:** an outgoing document names two incoming documents and shows both; each of those
shows the outgoing one as a reply; a reader scoped to only one of them sees exactly one reference
and cannot tell there is another; naming an unreadable document and naming a nonexistent one are
indistinguishable in both the link and the unlink path, with a test comparing the two responses;
linking a reply does not move either document's status; and the reference set is immutable once the
outgoing document is released.

---

## Phase status (updated 2026-10-01)

| Phase                              | Backend            | Frontend      | Notes                                                                 |
| ---------------------------------- | ------------------ | ------------- | --------------------------------------------------------------------- |
| 0 — Foundations                    | ✅ done            | n/a           | Cold-boot + IT sign-off are external gates (see `policy-register.md`) |
| 1 — Identity & Organization        | ✅ done            | ⬜ not started | Backend merged in PR #39. Frontend still owes: admin/org console, request-an-account screen |
| 2 — Document registry              | ✅ done            | ◑ mostly done | Aggregate Postgres-backed, `DtsApplicationService` retired (PR #40). UI: registry list/filters/sort/pagination/search, create+org picker, detail+timeline, metadata edit, forward/route all built (PRs #51–#56); delete/restore UI remains |
| 3 — Workflow & routing             | ◑ mostly done      | ◑ mostly done | Transitions, assignment, routing/forwarding, sharing, work queue persisted (PR #41); parallel-route completion semantics deferred (open policy). UI: allowed-actions bar + forward/route built; work-queue view remains |
| 4 — Files & scanning               | ✅ done            | ◑ mostly done | `file_records`/`file_versions` + `signature_events` persisted; MinIO adapter + ClamAV auto-scan worker wired. UI: upload + scan badges + gated download built (PR #53); inline PDF/image preview remains |
| 5 — Outbox, notifications, dashboard | ✅ done          | ◑ partial     | Notifications persisted in the domain tx; outbox **relay + BullMQ worker** on real Redis; realtime WS gateway live. UI: notifications inbox + live updates built (PR #50); scope-aware dashboard (pending-by-division, overdue, recent activity) still owed |
| 6 — Reports, routing slip, audit UI | ✅ done            | ◑ partial     | Monthly report (JSON/PDF/XLSX), routing-slip PDF, audit query all Postgres-backed and audited (`feat/phase-6-reports-audit`). UI: reports view + XLSX/PDF export built (PR #54); routing-slip download control + audit-trail viewer remain |
| 7 — Hardening & readiness          | ⬜ not started     | ⬜ not started |                                                                       |

Legend: ✅ done · ◑ partial · ⏳ deferred (planned for a later phase) · ⬜ not started. **The frontend
was deferred backend-first** by an explicit decision (`docs/phase-1-completion-report.md`); as of
2026-10-01 the operational workspace UI has been built out (PRs #50–#56 — notifications, registry
controls, org picker, attachments, reports, metadata edit, routing). The remaining UI surfaces are the
**admin/organization console**, the **request-an-account screen**, the **audit-trail viewer**, the
**scope-aware dashboard**, **delete/restore controls**, and **inline file preview** — plus all of
Phase 7.

---

## Global conventions (set once in Phase 0, obey forever)

**Rules for every slice**
- One PR = one vertical slice increment: migration + API + UI + tests. No "backend-only" or "UI-only" PRs unless it's scaffolding.
- Status/state changes go through domain services only. Controllers never write `workflow_status`.
- Every state-changing use case runs in **one DB transaction**: domain change + `workflow_event` + `audit_event` + `outbox_event` (+ notification rows).
- Every read (list, detail, count, export, file, realtime) passes through the authorization policy. Deny by default.
- Editable aggregates carry a `version` column → stale write returns `409 Conflict`.
- Runtime-validate all inputs (shared schema, e.g. Zod) at the API boundary; safe error envelope `{ code, message, details?, correlationId }`.

**Suggested repo layout**
```
/apps
  /api            # NestJS: modules/, common/, main.ts
  /worker         # BullMQ processors (same domain contracts)
  /web            # Next.js App Router
/packages
  /contracts      # shared request/response schemas + types
  /db             # Drizzle schema, migrations, seeds
  /config         # env validation, shared tsconfig/eslint
/infra
  docker-compose.yml, scanner config, backup scripts, runbooks
/docs
  adr/, policy-register.md, uat/
```

**Per-module backend shape**
```
modules/<name>/
  <name>.controller.ts     # HTTP only, thin
  <name>.service.ts        # use cases / commands
  <name>.repository.ts     # Drizzle queries (authorization predicates included)
  <name>.policy.ts         # authz rules for this module
  dto/                     # schemas from packages/contracts
  <name>.spec.ts / .int.spec.ts
```

---

## Phase 0 — Foundations (Wk 1–3)

> A phase receives a ⭐ only after every task, required test, and completion criterion is verified.

**Goal:** a repo where a new machine runs the whole stack, CI is green, and schema/ops conventions exist before any feature.

**Tasks (in order)**
- [x] Init monorepo, TS configs, lint/format, commit hooks.
- [x] `docker-compose.yml`: postgres, redis, minio, scanner, api, worker, web; health checks; named volumes.
- [x] Env validation module (fail fast on missing/invalid config).
- [x] Drizzle setup: migration runner, `id` (uuid) / `created_at` / `updated_at` / `version` base helpers.
- [x] Core tables: `audit_event`, `outbox_event`.
- [x] Common infra: correlation-ID middleware, structured logger, global exception filter (safe envelope), `/health` + `/ready`.
- [x] CI: lint → typecheck → unit → integration (Postgres service) → build.
- [x] Docs: ADRs (modular monolith, session transport, ID strategy), deployment decision record, policy register.

**Tests**

- [x] Health endpoint smoke test.
- [x] Migration up on an empty database test.
- [x] Environment validation failure test.

**PR slices:** `chore/repo-scaffold` · `chore/compose-stack` · `feat/db-conventions` · `feat/observability-baseline` · `chore/ci-pipeline`

**Done when:**

- [ ] Clean machine → `docker compose up` → healthy stack. *(Compose config validates and every service declares a health gate; an end-to-end cold boot on a clean machine has not been run.)*
- [x] CI green.
- [ ] No infrastructure blocker from IT. *(External sign-off; see P-13 in `policy-register.md`.)*

---

## Phase 1 — Identity & Organization (Wk 4–6)

**Goal:** people can request/receive accounts, log in, and every request is scoped by role + division/section.

**Schema**
- `division`, `section (division_id)`, `user (division_id, section_id, status, password_hash, photo_key)`, `role`, `user_role`, `account_request`, `session` (if server sessions).

**Endpoints**
```
POST /auth/login          POST /auth/logout
POST /account-requests    GET  /account-requests        POST /account-requests/{id}/approve|reject
POST /users               PATCH /users/{id}             POST /users/{id}/deactivate
GET/POST/PATCH /divisions, /sections
GET  /me                  POST /me/photo
```

**Backend tasks**
1. Identity module: bcrypt hashing, session/cookie issuance (HTTP-only, SameSite), inactivity expiry, CSRF protection.
2. Rate-limit guard (login, account-request).
3. Organization module CRUD + membership rules.
4. Admin flows: approve/reject, role assignment, deactivate (soft — keep identity for history).
5. **Authorization module:** `Policy` interface, `can(actor, action, resource)`, plus **query scoping helpers** (`scopeToActor(query, actor)`) — reused by every later repository.
6. Audit writer wired into all admin/auth actions.

**Frontend tasks**
- Login, request-account form, admin user table, approve/reject dialogs, division/section manager, profile + photo upload, session-expired handling.

**Tests**
- Auth: wrong password, lockout/rate limit, expiry, CSRF, no credential in logs.
- **Authorization matrix test** (table-driven: 5 roles × resources × actions) incl. cross-division and guessed-ID negatives.

**PR slices:** `feat/auth-session` · `feat/account-requests` · `feat/org-admin` · `feat/authz-policies-and-scoping`

**Done when:** matrix passes positive + negative; no list/detail/count/admin endpoint leaks data.

---

## Phase 2 — Document registry (Wk 7–9)

**Goal:** register, view, edit, list, and search documents end to end with scoped access.

> **Status (2026-09-29): backend slices complete.** The document aggregate is now Postgres-backed
> (`modules/documents/documents.repository.ts` + `documents.service.ts`), replacing the in-memory
> `DtsApplicationService`, which has been retired. Create (with atomic tracking + outgoing-reference
> allocation), list/search with authorization predicates in SQL, metadata edit with optimistic
> concurrency + revision history, and — carried along to keep the running app coherent — workflow
> transitions, assignment, and the attachment→document link are all durable. Attachment bytes/version
> metadata stay in an in-memory `AttachmentStore` until Phase 4 (Files & scanning); notification and
> report *reads* now come from Postgres, but their own persistence lands in Phases 5–6.
> **Frontend is deferred to a later phase** (consistent with the Phase 1 frontend deferral), so this
> was a backend + tests increment rather than a full vertical slice. Covered by
> `test/documents.int.test.ts` against real Postgres in CI.

**Schema**
- `document (direction, title, type, description, priority, sender, company, external_ref, reference_number UNIQUE, workflow_status, owner_division_id, version, deleted_at)`
- `document_metadata_revision`, `workflow_event`, `reference_counter (division_id, scope_key, next_value)`

**Endpoints**
```
POST  /documents            GET /documents            GET /documents/{id}
PATCH /documents/{id}/metadata      (If-Match / version)
```

**Backend tasks**
1. [x] Document create use case (incoming keeps external ref; outgoing allocates reference).
2. [x] **Reference allocation:** atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING` on `reference_counters` inside the create transaction (per division + year); tracking numbers from a separate office-wide `document_sequences` counter.
3. [x] Metadata edit with optimistic version check → writes `document_metadata_revisions` + audit.
4. [x] List query: limit/offset pagination, deterministic sort (sort key + `id` tiebreak), filters (status, priority, type, direction, division, section), search on title/tracking/reference/sender/company — **authorization predicates in the SQL** (`documentScopeFor`), never post-filtered in app memory.
5. [ ] Add indexes only after `EXPLAIN` on seeded representative data (B-tree, trigram if measured). _(Deferred to the Phase 6/hardening EXPLAIN pass; the scope/sort indexes from Phase 0 already back these queries.)_

**Frontend tasks**
- Create form (incoming/outgoing variants), detail page + timeline, edit metadata with conflict UX, list with filters/sort/pagination/search.

**Tests**
- [x] Concurrency: N parallel outgoing creates → N unique references. _(`documents.int.test.ts`, 12 parallel.)_
- [x] Conflict: two edits → second gets 409. _(Also a stale workflow action → 409.)_
- [x] Search/filter authorization; pagination stability. _(Cross-scope doc excluded from a staff member's totals; the pure `document-search` unit suite covers boundary inputs and sort/pagination.)_

**PR slices:** `feat/document-create` · `feat/reference-allocation` · `feat/metadata-edit-history` · `feat/document-list-search` _(delivered together on `feat/phase-2-document-registry`, backend-only per the frontend deferral.)_

**Done when:** records staff can register + retrieve; no duplicate refs; counts and results respect scope. — **met** (backend + integration tests; frontend deferred).

---

## Phase 3 — Workflow & routing (Wk 10–13)

**Goal:** full predefined workflow enforced by the server, with assignments and multi-division routing.

> **Status (2026-09-29): backend mostly done.** The workflow FSM (transition table + guards),
> `allowed-actions`, and the persisted transitions/assignment landed with Phase 2 (brought forward
> for coherence). This branch adds **routing/forwarding** (`POST /documents/:id/routes` — moves the
> document's owning division/section and records the hop in `document_routes`, under optimistic
> concurrency), **sharing** (`POST /documents/:id/shares` — grants one user read access via
> `document_shares`), and the **work queue** (`GET /documents/assigned`). Deferred: **parallel routes +
> completion semantics** (an open policy question — "per agreement" below), and **`signature_events`**
> rows, which FK to `file_versions` and therefore wait for Phase 4 (SIGN already records the signed
> version on the document row via `signedFileVersionId`). Frontend deferred.

**Schema**
- `document_assignment`, `document_route`, `document_share`, `signature_event`, `release_event (method)`, remarks (on `workflow_event`).

**Endpoints**
```
GET  /documents/{id}/allowed-actions
POST /documents/{id}/actions/{action}     # accept, return, resubmit, submit-signature, sign,
                                          # prepare-release, release, archive, restore
POST /documents/{id}/routes               # + assignment/share endpoints
```

**Backend tasks**
1. [x] **Transition table as data:** `{ from, action, to }` in `WorkflowService`; it is the only decider, and `DocumentsService.executeAction` the only writer of `workflow_status`.
2. [~] Guards live inside `WorkflowService.execute` (remark-required, clean+signed-attachment, release-method); extracting them into individually named pure functions is a tidy-up, not yet done.
3. [x] `allowed-actions` = filter the table by actor capability + state (VIEWER excluded).
4. [x] Assignment + section routing (`POST /documents/:id/routes`, downward move) + work-queue query (`GET /documents/assigned`).
5. [~] Routing records `document_routes` and blocks the no-op self-route; **parallel routes + completion semantics deferred** (open policy — see "per agreement").
6. [x] Release records method in `release_events`; archive/restore work; **`signature_events` now persisted** (Phase 4 landed `file_versions`), and SIGN records `signedFileVersionId` on the row.
7. [x] Return-for-revision requires a remark (validated in `WorkflowService`).

**Frontend tasks**
- Action bar driven by `allowed-actions` (never hard-code button logic), remark dialogs, assign/route pickers, work-queue views, timeline with per-route visibility.

**Tests**
- **Table-driven:** every legal transition passes; every other (from,action) pair is rejected.
- Race: two actors act simultaneously → one wins, one gets conflict.
- Scope: Viewer cannot act; cross-division actor cannot route/see.
- Release blocked without signature (attachment check wired in Phase 4).

**PR slices:** `feat/workflow-engine` · `feat/assignment-section-routing` · `feat/parallel-routes` · `feat/sign-release-archive`

**Done when:** every legal path works E2E, illegal ones 4xx, ownership/location unambiguous after each action.

---

## Phase 4 — Files & scanning (Wk 14–16)

**Goal:** private, immutable, scanned files; nothing downloadable unless CLEAN.

> **Status (2026-09-29): persistence + storage seam done; scanner infra deferred.** Attachment
> metadata now lives in Postgres (`file_records` + `file_versions`, one version immutable except its
> `scan_status`), and bytes live behind a `StoragePort` whose current binding is an in-memory adapter
> (server-generated quarantine keys, no overwrite) — a MinIO/S3 adapter drops in without touching the
> use cases. Upload sniffs the real media type, enforces the size limit, and quarantines as PENDING;
> download **fails closed** until CLEAN; a final scan result is immutable; the IDOR guard is a SQL
> join. `signature_events` are now persisted (closing the Phase 3 deferral). **Deferred:** the MinIO
> adapter, the ClamAV **scan worker** (BullMQ/Redis) — the manual `POST …/scan` endpoint stands in for
> it — and short-lived/presigned download. These need running services the sandbox can't host and are
> best landed with the infra they target. Frontend deferred.

**Schema**
- `file_record (document_id)`, `file_version (file_record_id, version_number, object_key, checksum, size, mime, scan_status)`, `file_scan (file_version_id, result, attempts, scanned_at)`; unique `(file_record_id, version_number)`.

**Endpoints**
```
POST /documents/{id}/files            POST /files/{id}/versions
GET  /files/{id}/versions/{vid}/content
```

**Backend tasks**
1. [~] Storage port (`put`/`get`, no overwrite, server-generated keys) — **done** with an in-memory adapter; **MinIO adapter deferred**.
2. [~] Upload use case: authorize → size/type limits at ingress → insert `PENDING` version → store bytes under the quarantine key → checksum. **Done**; enqueue-scan-via-outbox lands with the worker.
3. [ ] Scan worker: stream to scanner, set `CLEAN`/`INFECTED`/`SCAN_FAILED`; bounded retries; **fail closed**. **Deferred** (needs ClamAV + Redis); the manual `POST …/scan` endpoint stands in, and download already fails closed.
4. [~] Content endpoint: authorize → require `CLEAN` → `nosniff` + attachment disposition. **Done** (in-memory bytes); short-lived/presigned access lands with MinIO.
5. [x] Release guard: outgoing needs its current attachment CLEAN **and** signed — enforced from the persisted version + document row.

**Frontend tasks**
- Multi-file upload with per-version status chips, version history, PDF/image preview, download, infected/failed messages.

**Tests**
- Scanner: clean / infected / down / timeout; spoofed extension; oversize.
- IDOR: guess object key, other division's file id, direct URL → all denied.
- Version immutability: no update/delete path exists; range/large-file download.

**PR slices:** `feat/storage-adapter-versions` · `feat/quarantine-scan-worker` · `feat/preview-download` · `feat/release-invariant`

**Done when:** no unscanned/non-clean object is retrievable; outgoing release invariant enforced.

---

## Phase 5 — Outbox, notifications, dashboard (Wk 17–19)

**Goal:** committed events are never lost; users get notifications live and after reconnect.

> **Status (2026-09-29): durable pipeline + dashboard done; realtime deferred.** Notification rows
> are written in the **same transaction** as the domain change (`NotificationsRepository.insert` inside
> the assignment tx), so a notification can't be lost to a downed worker. The **outbox relay**
> (`modules/jobs/outbox-relay.ts`) leases unpublished `outbox_events` with `FOR UPDATE SKIP LOCKED`,
> enqueues an idempotent **BullMQ** job (jobId = outbox row id) and marks them published; the **worker**
> (`worker.ts`) runs the relay on an interval and a BullMQ `Worker` consumes the queue. This is tested
> against a **real Redis** (run natively; a `redis` service added to the CI integration job). The
> **dashboard summary** (`GET /dashboard/summary`) reuses `documentScopeFor`. **Deferred:** the realtime
> WS/SSE gateway (task 4) — the consumer is the seam where it plugs in — and per-recipient email; the
> durable inbox works without them. Frontend deferred.

**Schema**
- `notification (user_id, type, document_id, read_at, seq)`; outbox columns: `status`, `lease_until`, `attempts`, `idempotency_key`.

**Endpoints**
```
GET  /notifications?cursor=      POST /notifications/{id}/read
GET  /dashboard/summary          (+ realtime channel)
```

**Backend tasks**
1. [x] **Outbox publisher:** lease unpublished rows (`FOR UPDATE SKIP LOCKED`) → enqueue idempotent BullMQ job → mark published, all in one transaction.
2. [x] Job conventions: queue name, typed payload, idempotency (jobId = outbox row id), bounded retries + exponential backoff, failures kept for inspection.
3. [~] Notification rows written in the domain transaction; audience resolver currently covers assignment (assignee). Route/workflow audiences are easy follow-ons.
4. [ ] Realtime gateway (authenticated subscribe, authorized fan-out, catch-up) — **deferred**; the queue consumer is the plug-in point.
5. [x] Dashboard summary reuses the scoped list predicate (`documentScopeFor`) — one source of truth for scope.

**Frontend tasks**
- Notification bell + inbox, unread badge, mark-read, reconnect/catch-up, dashboard cards, pending-by-division chart, activity feed, quick accept/assign, overdue highlighting.

**Tests**
- Kill worker between commit and publish → event still delivered exactly once (effect-wise).
- Duplicate delivery, Redis restart, poison job.
- Offline → reconnect → no duplicates, correct order; multi-tab; subscription can't receive other-division events.
- Dashboard totals == underlying list query counts.

**PR slices:** `feat/outbox-publisher` · `feat/notifications-persist-realtime` · `feat/dashboard`

**Done when:** notifications survive disconnect and API/worker restart; dashboard reconciles.

---

## Phase 6 — Reports, routing slip, audit UI (Wk 20–21)

**Goal:** operational exports and evidence viewing.

> **Status (2026-09-29): backend done.** Monthly reports (JSON / PDF / XLSX) and the routing-slip
> PDF were delivered earlier and are scope-aware; spreadsheet cells starting with `= + - @` are
> sanitised against formula injection. This branch (`feat/phase-6-reports-audit`) closed the two
> remaining gaps: the **audit query API** now takes the documented `user` / `action` / `from` / `to`
> filters plus `limit`/`offset` pagination (ISO dates validated, malformed → `400`; backed by the
> existing `(actor, action, occurred_at)` index, no migration), and **every file export is now its
> own audit event** — `report.exported` (`{ format, year, month }`) for the PDF/XLSX and
> `document.routing-slip-exported` for the slip, IDs/format only, distinct from the on-screen
> `report.monthly-viewed`. Verified against real Postgres + Redis in Docker; see
> `docs/phase-6-completion-report.md`. **Frontend deferred** to the UI track, per every prior phase.

**Endpoints**
```
GET /reports/monthly  |  /reports/monthly.pdf  |  /reports/monthly.xlsx
GET /documents/{id}/routing-slip.pdf
GET /audit-events?user=&action=&from=&to=
```

**Backend tasks**
1. [x] Report definition module: explicit aggregate queries (incoming/outgoing/FOI/special-order per month), scope-aware.
2. [x] PDF + XLSX generators; **sanitize cells starting with `= + - @`** (formula injection); **audit each export** (`report.exported` with format/period).
3. [x] Routing slip renderer: branding config, timeline, remarks, statuses; export audited (`document.routing-slip-exported`).
4. [x] Audit query API (insert + read only for app DB role), filters (`user`/`action`/`from`/`to`), pagination (`limit`/`offset`); restrict to auditor/admin scope.

**Frontend tasks** _(deferred to the UI track)_
- Report page (month/year filter, print view, export buttons), routing-slip print action, audit table + filters.

**Tests**
- [x] Fixture data → totals reconcile; PDF/XLSX open/validate; formula-injection payloads (`monthly-report.test.ts`).
- [x] Every export writes a distinct audit event carrying IDs/format only — no body text or party names (`api.test.ts`).
- [x] Audit query filters + pagination end-to-end over HTTP, malformed date → `400` (`identity.int.test.ts`).

**PR slices:** `feat/monthly-reports` · `feat/report-exports-safe` · `feat/routing-slip` · `feat/audit-viewer` _(delivered together on `feat/phase-6-reports-audit`, backend-only per the frontend deferral.)_

**Done when:** records staff sign off totals; routing slip approved; every critical scenario traceable in audit. — **backend met** (integration tests against real Postgres; formula-injection + export-audit + audit-query covered; frontend + records-staff sign-off deferred to the UI track).

---

## Phase 7 — Hardening & readiness (Wk 22–24)

**Goal:** prove it's safe, fast, accessible, and recoverable.

**Tasks**
1. **A11y pass:** keyboard/focus order, labels, contrast, reduced motion, loading/empty/error/success states, viewport matrix.
2. **Performance:** seed pilot-sized data; `EXPLAIN` critical queries; add/adjust indexes; fix N+1s; large-list behavior.
3. **Security:** threat-model pass, rate limits on upload/report, secure headers, CORS allowlist, dependency + container scans, log redaction check.
4. **Ops:** backup scripts for Postgres + MinIO together; **perform a real restore**; monitoring/alerts; runbooks (incident, recovery, scanner down, Redis loss).
5. **RC build:** deploy to production-like env, run migrations on empty + representative DB, smoke/regression/load.
6. Guides + UAT scripts + training seed data.

**Done when:** no critical a11y/security findings; restore demonstrated; four-party readiness sign-off.

---

## Contingency (Wk 25–30) — UAT → pilot

Treat as a **bug/defect branch flow**, not feature work:
- Triage board: `severity-1 / 2 / 3` vs `policy-question` (keep separate).
- Hotfix path: branch from RC tag → fix + regression test → re-run affected suites (security, workflow, report, file).
- Cutover checklist: prod config, secrets, branding assets, baseline data, backups, monitoring, rollback rehearsal.
- Exit: stable observation window, go/no-go decision recorded.

---

## Definition of Done (copy into PR template)

- [ ] Migration included, reversible/recovery note, runs on empty + populated DB
- [ ] Input validated with shared schema; safe errors only
- [ ] Authorization enforced server-side incl. negative tests
- [ ] State change is atomic with timeline + audit + outbox (if applicable)
- [ ] Optimistic concurrency where entity is editable
- [ ] Unit + integration + API tests added; critical path has E2E
- [ ] Structured logs/correlation ID present; no secrets/PII in logs
- [ ] UI has loading/empty/error/success states + keyboard access
- [ ] CI green (lint, types, tests, build, migration check)
