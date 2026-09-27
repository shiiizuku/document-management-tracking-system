export type Role = 'ADMINISTRATOR' | 'RECORDS_STAFF' | 'DIVISION_HEAD' | 'STAFF_MEMBER' | 'VIEWER';

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

    if (actor.role === 'ADMINISTRATOR' || actor.role === 'RECORDS_STAFF') {
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
