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

export interface AuthorizationResource {
  id: string;
  divisionId: string | null;
  sectionId: string | null;
  assigneeUserIds: readonly string[];
  sharedUserIds: readonly string[];
  confidential: boolean;
}

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

    if (actor.role === 'DIVISION_HEAD') {
      return actor.divisionId !== null && actor.divisionId === resource.divisionId;
    }

    return (
      actor.sectionId !== null &&
      actor.divisionId === resource.divisionId &&
      actor.sectionId === resource.sectionId
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
