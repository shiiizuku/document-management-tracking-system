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
      reachable.push(eq(documents.divisionId, actor.divisionId));
    } else if (actor.sectionId !== null) {
      reachable.push(
        and(eq(documents.divisionId, actor.divisionId), eq(documents.sectionId, actor.sectionId))!,
      );
    }
  }

  return and(confidentialityGate, or(...reachable))!;
};

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
 * Applies {@link documentScopeFor} to a query builder. The `scopeToActor(query, actor)` form
 * is what repositories call; it exists so that forgetting to scope a query reads as a missing
 * call at the call site rather than as a subtly absent `and(...)` inside a long predicate.
 */
export const scopeToActor = <TQuery extends Scopable<TQuery>>(
  query: TQuery,
  actor: AuthorizationActor,
): TQuery => query.where(documentScopeFor(actor));
