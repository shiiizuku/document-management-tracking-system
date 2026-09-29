import { and, eq, exists, or, sql, type SQL } from 'drizzle-orm';
import type { AuthorizationActor } from './authorization.policy.js';
import { documentAssignments, documents, documentShares } from '../../database/schema.js';

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

  // Records staff and administrators work across the whole office; the confidentiality gate
  // above is still the only thing standing between them and a restricted document.
  if (actor.role === 'ADMINISTRATOR' || actor.role === 'RECORDS_STAFF') {
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
        and(
          eq(documents.divisionId, actor.divisionId),
          eq(documents.sectionId, actor.sectionId),
        )!,
      );
    }
  }

  return and(confidentialityGate, or(...reachable))!;
};

/** A query builder narrow enough to accept a scoping predicate. */
interface Scopable<TSelf> {
  where(condition: SQL): TSelf;
}

/**
 * Applies {@link documentScopeFor} to a query builder. The `scopeToActor(query, actor)` form
 * is what repositories call; it exists so that forgetting to scope a query reads as a missing
 * call at the call site rather than as a subtly absent `and(...)` inside a long predicate.
 */
export const scopeToActor = <TQuery extends Scopable<TQuery>>(
  query: TQuery,
  actor: AuthorizationActor,
): TQuery => query.where(documentScopeFor(actor));
