export type Role =
  'ADMINISTRATOR' | 'RECORDS_STAFF' | 'DIRECTOR' | 'DIVISION_HEAD' | 'STAFF_MEMBER' | 'VIEWER';

/**
 * The roles whose read scope is the whole office rather than their placement.
 *
 * `DIRECTOR` is the first of these that is *placed* — it sits in the ORD (ADR-0006) — so the
 * office-wide branch can no longer be read as "the roles with no division". It must still review
 * any division's work in order to sign it. Records staff and the Director are not interchangeable
 * even though they share this branch: records staff see everything and sign nothing, the Director
 * sees everything and signs.
 *
 * Exported because `documentScopeFor` in `query-scope.ts` is the SQL twin of `canRead` and must
 * branch on the same set; the two drifting apart is the failure this constant exists to prevent.
 */
export const OFFICE_WIDE_READ_ROLES: ReadonlySet<Role> = new Set<Role>([
  'ADMINISTRATOR',
  'RECORDS_STAFF',
  'DIRECTOR',
]);

export interface AuthorizationActor {
  id: string;
  role: Role;
  divisionId: string | null;
  sectionId: string | null;
  capabilities: readonly string[];
  canAccessConfidential: boolean;
}

/**
 * One custody hop, as scope sees it.
 *
 * `accepted_at` is deliberately absent rather than merely unused: acceptance gates what a recipient
 * may *do* (the workflow engine's `leadRouteOutstanding`), never whether they may read — a unit that
 * cannot open a document can never accept it. Leaving the field off the type means that rule cannot
 * be broken here by someone adding one plausible-looking condition.
 */
export interface RouteRecipient {
  toDivisionId: string;
  toSectionId: string | null;
  forInformation: boolean;
}

export interface AuthorizationResource {
  id: string;
  /** Where the document was *registered*. It never moves; custody lives on `routes` (ADR-0005). */
  divisionId: string | null;
  sectionId: string | null;
  /**
   * Every hop this document has been through. Required, not optional: a resource built without it
   * would silently deny the receiving unit, which is the whole of what routing is for. The same
   * trap `monthly-report.ts` documents for assignment and share membership.
   */
  routes: readonly RouteRecipient[];
  assigneeUserIds: readonly string[];
  sharedUserIds: readonly string[];
  confidential: boolean;
}

/**
 * The in-memory twin of `routedToUnit` in `query-scope.ts`, with the same deliberate properties:
 * acceptance is not consulted, a unit that forwarded a document onward still matches the hop by
 * which it received it, and a `null` `sectionId` means "any hop into this division" (the division
 * head's reach). A section id matches its own section's hops and any lead hop to the division as
 * a whole (decision 180), but not a copy for information, which stays with the head (decision 160).
 */
const routesReachUnit = (
  routes: readonly RouteRecipient[],
  divisionId: string,
  sectionId: string | null,
): boolean =>
  routes.some(
    (route) =>
      route.toDivisionId === divisionId &&
      (sectionId === null ||
        route.toSectionId === sectionId ||
        (route.toSectionId === null && !route.forInformation)),
  );

export class AuthorizationPolicy {
  canRead(actor: AuthorizationActor, resource: AuthorizationResource): boolean {
    if (resource.confidential && !actor.canAccessConfidential) {
      return false;
    }

    // The confidentiality gate above has already run, and it is the only thing standing between
    // an office-wide reader and a restricted document.
    if (OFFICE_WIDE_READ_ROLES.has(actor.role)) {
      return true;
    }

    if (resource.sharedUserIds.includes(actor.id) || resource.assigneeUserIds.includes(actor.id)) {
      return true;
    }

    if (actor.divisionId === null) {
      return false;
    }

    if (actor.role === 'DIVISION_HEAD') {
      return (
        actor.divisionId === resource.divisionId ||
        routesReachUnit(resource.routes, actor.divisionId, null)
      );
    }

    return (
      actor.sectionId !== null &&
      ((actor.divisionId === resource.divisionId && actor.sectionId === resource.sectionId) ||
        routesReachUnit(resource.routes, actor.divisionId, actor.sectionId))
    );
  }

  can(actor: AuthorizationActor, resource: AuthorizationResource, capability: string): boolean {
    if (actor.role === 'VIEWER') {
      return false;
    }
    return this.canRead(actor, resource) && actor.capabilities.includes(capability);
  }

  filterReadable<T extends AuthorizationResource>(
    actor: AuthorizationActor,
    resources: readonly T[],
  ): T[] {
    return resources.filter((resource) => this.canRead(actor, resource));
  }
}
