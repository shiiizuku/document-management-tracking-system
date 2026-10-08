import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';
import { OFFICE_WIDE_READ_ROLES, type AuthorizationActor } from './authorization.policy.js';
import {
  documentAssignments,
  documentRoutes,
  documents,
  documentShares,
} from '../../database/schema.js';

/**
 * The SQL twin of `AuthorizationPolicy.canRead`. Every repository that lists, counts or
 * exports documents composes this into its `WHERE` clause, so rows an actor may not see are
 * never fetched — decision register 90: scope is enforced before data reaches a controller,
 * not filtered afterwards. Filtering in TypeScript would leak through `COUNT(*)`,
 * pagination totals and CSV exports even when the payload looked correct.
 *
 * Keep this in lockstep with `canRead`. `test/query-scope.test.ts` asserts the branches and
 * `test/query-scope.int.test.ts` asserts that real Postgres agrees with the in-memory policy
 * for the same fixtures.
 */
export const documentScopeFor = (actor: AuthorizationActor): SQL => {
  const confidentialityGate = actor.canAccessConfidential
    ? sql`true`
    : eq(documents.confidential, false);

  // Records staff, administrators and the Director work across the whole office; the
  // confidentiality gate above is still the only thing standing between them and a restricted
  // document. The set is shared with `canRead` so the two halves cannot disagree about who is in
  // this branch — note that the Director is in it while also being placed in a division, so the
  // placement checks below must stay unreachable for that role.
  if (OFFICE_WIDE_READ_ROLES.has(actor.role)) {
    return and(confidentialityGate)!;
  }

  const assignedToActor = exists(
    sql`(select 1 from ${documentAssignments}
         where ${documentAssignments.documentId} = ${documents.id}
           and ${documentAssignments.userId} = ${actor.id}
           and ${documentAssignments.active} = true)`,
  );
  const sharedWithActor = exists(
    sql`(select 1 from ${documentShares}
         where ${documentShares.documentId} = ${documents.id}
           and ${documentShares.userId} = ${actor.id})`,
  );

  const reachable: SQL[] = [assignedToActor, sharedWithActor];
  if (actor.divisionId !== null) {
    if (actor.role === 'DIVISION_HEAD') {
      reachable.push(
        or(eq(documents.divisionId, actor.divisionId), routedToUnit(actor.divisionId, null))!,
      );
    } else if (actor.sectionId !== null) {
      reachable.push(
        or(
          and(eq(documents.divisionId, actor.divisionId), eq(documents.sectionId, actor.sectionId)),
          routedToUnit(actor.divisionId, actor.sectionId),
        )!,
      );
    }
  }

  return and(confidentialityGate, or(...reachable))!;
};

/**
 * Whether any custody hop addressed this actor's unit — the route-derived half of placement scope
 * (ADR-0005). It is what lets a document be read where it actually *is* rather than only where it
 * was registered, now that `documents.division_id` is the registering placement and never moves.
 *
 * Three things about it are deliberate:
 *
 * - **`accepted_at` is not consulted.** ADR-0005 reads "scope resolves through accepted route rows",
 *   which taken literally is unimplementable: `ACCEPT` is reached from the detail view, so a
 *   recipient who cannot read a document can never accept it. Acceptance gates *actions* —
 *   `leadRouteOutstanding` in the workflow engine — not visibility.
 * - **A unit that forwarded a document onward keeps it.** No `from_division_id` clause is needed for
 *   that: the hop by which the unit received the document is still on record, so read accumulates
 *   along the custody chain. This is a widening over the destructive `relocate` it replaces, and it
 *   is intended (decision 176) — the unit that handled a document can still answer for it.
 * - **Section actors match a lead hop to their division as a whole, but not a copy for
 *   information.** A forward addressed to the division without naming a section is handed to
 *   every section in it (decision 180), the same people the forward notifies. A for-information
 *   copy is division-level too (decision 160), yet it reaches the division head only: being
 *   consulted is not being handed the document.
 *
 * A `null` `sectionId` means "any hop into this division", which is the division head's reach; a
 * section id narrows to that section's own hops plus the division-wide lead hops. Kept in lockstep
 * with `routesReachUnit` in `authorization.policy.ts`, its in-memory twin.
 */
const routedToUnit = (divisionId: string, sectionId: string | null) =>
  exists(
    sql`(select 1 from ${documentRoutes}
         where ${documentRoutes.documentId} = ${documents.id}
           and ${documentRoutes.toDivisionId} = ${divisionId}
           ${
             sectionId === null
               ? sql``
               : sql`and (${documentRoutes.toSectionId} = ${sectionId}
                          or (${documentRoutes.toSectionId} is null
                              and ${documentRoutes.forInformation} = false))`
           })`,
  );

/**
 * The document's current custody hop.
 *
 * Hand-aliased `lead_hop` rather than built with Drizzle's `alias()`, because interpolating an
 * aliased table into a `sql` template emits only the alias and not the `"document_routes"
 * "lead_hop"` the `FROM` needs. The alias itself is not optional: `pendingByDivision` and the
 * registry filter compose these expressions into queries that may also touch `document_routes`,
 * and an unaliased correlated subquery would then bind to the outer row instead of its own.
 */
const leadHopOf = (
  column: 'to_division_id' | 'to_section_id',
) => sql`(select lead_hop.${sql.raw(column)}
     from ${documentRoutes} lead_hop
     where lead_hop.document_id = ${documents.id}
       and lead_hop.for_information = false
     order by lead_hop.created_at desc, lead_hop.id desc
     limit 1)`;

/**
 * Whether the document has any custody hop at all.
 *
 * A named fragment rather than an inline one, because Drizzle only qualifies an interpolated column
 * inside a *nested* `sql` chunk: written directly into the `CASE` below, `${documents.id}` renders
 * as a bare `"id"`, which inside this subquery resolves to `lead_hop.id` and makes the condition
 * `lead_hop.document_id = lead_hop.id` — always false, so every document would report its
 * registering section as its custody section. The integration suite caught exactly that.
 */
const anyLeadHop = sql`exists (select 1
     from ${documentRoutes} lead_hop
     where lead_hop.document_id = ${documents.id}
       and lead_hop.for_information = false)`;

/**
 * Where the document is **now**: the division of the most recent hop that took custody, falling
 * back to the registering placement for rows that predate migration `0005` and have no hops.
 *
 * This is what `documents.division_id` used to answer, before ADR-0005 made routing
 * non-destructive and left that column recording where a document was *registered*. Everything
 * that asks the user's question — "which documents are at this division", "who is sitting on
 * pending work" — composes this, and composing the same expression is what keeps the dashboard's
 * division chart clickable: a tile that counted custody while the list it links to filtered on
 * origin would disagree with itself the first time anything was forwarded.
 *
 * Only the **lead** hop counts, because a forward names exactly one recipient that takes custody
 * (decision 159) and copies for information are explicitly never work in hand (decision 160).
 *
 * Ordering is by `created_at`, which is the transaction clock: registration and each forward happen
 * in their own transaction, so two lead hops on one document always differ. The `id` tie-break
 * behind it is arbitrary — ids are random — and is reachable only by writing two lead hops in a
 * single statement, which no code path does and which a fixture should not either.
 */
export const custodyDivisionId = (): SQL<string> =>
  sql<string>`coalesce(${leadHopOf('to_division_id')}, ${documents.divisionId})`;

/**
 * The section half of {@link custodyDivisionId}. A `CASE` rather than a `COALESCE` because a hop to
 * a whole division has no section, and `COALESCE` would then quietly fall through to the
 * registering section — reporting a document as sitting in a section nobody routed it to.
 */
export const custodySectionId = (): SQL<string | null> =>
  sql<string | null>`(case
    when ${anyLeadHop}
    then ${leadHopOf('to_section_id')}
    else ${documents.sectionId}
  end)`;

/**
 * A query builder narrow enough to accept a scoping predicate.
 */
interface Scopable<TSelf> {
  where(condition: SQL): TSelf;
}

/**
 * The derived `PENDING` condition: a document is pending while any route handed to a recipient
 * remains unaccepted (decision 157, ADR-0005).
 *
 * `PENDING` is a status to users and a filter in lists, but it is deliberately not a column — one
 * column cannot say that two of three divisions have accepted. Because it cannot be indexed as a
 * column either, every list, dashboard rollup and report that asks the question composes *this*
 * expression, rather than each growing its own `EXISTS` and drifting apart. The partial index
 * `document_routes_unaccepted_idx` backs the probe.
 *
 * Pass `false` for the complement — documents with nothing outstanding — so the two halves of the
 * filter can never disagree about what pending means.
 */
export const documentIsPending = (pending = true): SQL => {
  const outstanding = exists(
    sql`(select 1 from ${documentRoutes}
         where ${documentRoutes.documentId} = ${documents.id}
           and ${documentRoutes.acceptedAt} is null)`,
  );
  return pending ? outstanding : sql`not ${outstanding}`;
};

/**
 * {@link documentIsPending}, phrased for a rollup that evaluates it on every row of a scan — the
 * dashboard's `count(*) filter (where …)`. Same question, same rows: a document is in the set
 * exactly when it has an unaccepted route.
 *
 * The `EXISTS` form suits a `WHERE`, where Postgres can drive the probe from
 * `document_routes_unaccepted_idx`. Inside a `FILTER` it becomes a correlated subplan run once per
 * row, which on the D1 seed made the Records Section's summary five times slower. As `IN`, Postgres
 * reads the unaccepted routes once into a hash and each row is a lookup (D2 follow-up F1).
 */
export const documentIsPendingInRollup = (): SQL =>
  sql`${documents.id} in (select ${documentRoutes.documentId} from ${documentRoutes}
       where ${documentRoutes.acceptedAt} is null)`;

/**
 * The overdue condition: a document still open past its due date.
 *
 * One expression for the dashboard's Overdue tile and the registry's `overdue=true` filter, so the
 * tile and the list it links to can never disagree — the same one-source-of-truth idea as scope
 * (decision register 90) and {@link documentIsPending}. It was inline in the dashboard rollup until
 * the tile became a link; it is moved here unchanged.
 *
 * Note what "open" means here: every status but RELEASED and ARCHIVED. A COMPLIED document whose
 * due date has passed therefore counts as overdue. That is the rule the tile has always used, and
 * changing it is a product decision rather than a refactor, so it is recorded here, not altered.
 *
 * Written as plain comparisons rather than `EXISTS`, so it reads the same in a `WHERE` and inside a
 * rollup's `count(*) filter (where …)`.
 */
export const documentIsOverdue = (): SQL =>
  sql`${documents.status} not in ('RELEASED', 'ARCHIVED')
      and ${documents.dueAt} is not null and ${documents.dueAt} < now()`;

/**
 * Applies {@link documentScopeFor} to a query builder. The `scopeToActor(query, actor)` form
 * is what repositories call; it exists so that forgetting to scope a query reads as a missing
 * call at the call site rather than as a subtly absent `and(...)` inside a long predicate.
 */
export const scopeToActor = <TQuery extends Scopable<TQuery>>(
  query: TQuery,
  actor: AuthorizationActor,
): TQuery => query.where(documentScopeFor(actor));
