import type { AuthorizationActor, Role } from './authorization.policy.js';
import { actionVerb, type Policy } from './policy.js';
import {
  ACCOUNT_REQUEST_REVIEW,
  AUDIT_VIEW,
  ORG_MANAGE,
  USER_MANAGE,
} from './role-capabilities.js';

/** The slice of a user row any identity decision is allowed to depend on. */
export interface UserResource {
  id: string;
  role: Role;
  divisionId: string | null;
  sectionId: string | null;
}

export type UserAction =
  'user:list' | 'user:read' | 'user:create' | 'user:update' | 'user:deactivate' | 'user:reactivate';

export class UserPolicy implements Policy<UserResource> {
  readonly resourceType = 'user';

  can(actor: AuthorizationActor, action: string, resource: UserResource | null): boolean {
    const manages = actor.capabilities.includes(USER_MANAGE);
    switch (actionVerb(action)) {
      case 'list':
      case 'create':
        return manages;
      case 'read':
        // Anyone may read themselves — that is what `GET /me` and the profile page need.
        // Division heads may read their own division so they can pick assignees; everyone
        // else needs the management capability.
        if (resource === null) return manages;
        if (resource.id === actor.id) return true;
        if (manages) return true;
        return (
          actor.role === 'DIVISION_HEAD' &&
          actor.divisionId !== null &&
          actor.divisionId === resource.divisionId
        );
      case 'update':
        return manages && resource !== null;
      case 'deactivate':
      case 'reactivate':
        // Deactivating yourself would lock the last administrator out of their own console
        // and is never a legitimate admin action, so it is denied at the policy layer where
        // the matrix test can see it.
        return manages && resource !== null && resource.id !== actor.id;
      default:
        return false;
    }
  }
}

export type AccountRequestAction =
  'account-request:list' | 'account-request:approve' | 'account-request:reject';

export class AccountRequestPolicy implements Policy<null> {
  readonly resourceType = 'account-request';

  can(actor: AuthorizationActor, action: string): boolean {
    const reviews = actor.capabilities.includes(ACCOUNT_REQUEST_REVIEW);
    switch (actionVerb(action)) {
      case 'list':
      case 'approve':
      case 'reject':
        return reviews;
      default:
        return false;
    }
  }
}

export type OrganizationAction =
  'organization:read' | 'organization:create' | 'organization:update';

export class OrganizationPolicy implements Policy<null> {
  readonly resourceType = 'organization';

  can(actor: AuthorizationActor, action: string): boolean {
    switch (actionVerb(action)) {
      // Every authenticated user reads the org tree: it populates the division and section
      // pickers on the document form. Mutating it is an administrative act.
      case 'read':
        return true;
      case 'create':
      case 'update':
        return actor.capabilities.includes(ORG_MANAGE);
      default:
        return false;
    }
  }
}

export type RoleAction = 'role:list';

/**
 * Reading what each role grants (`GET /roles`). Open to whoever picks a role for someone else —
 * creating or editing a user, or approving an account request — because those are the screens the
 * map describes. The endpoint's existence is not secret, so anyone else gets a plain 403.
 */
export class RolePolicy implements Policy<null> {
  readonly resourceType = 'role';

  can(actor: AuthorizationActor, action: string): boolean {
    return (
      actionVerb(action) === 'list' &&
      (actor.capabilities.includes(USER_MANAGE) ||
        actor.capabilities.includes(ACCOUNT_REQUEST_REVIEW))
    );
  }
}

export type AuditEventAction = 'audit-event:list';

/**
 * The audit trail is the record of who did what, including to whom. Reading it is gated on
 * the audit capability alone and never widened by division: an actor who can see the trail
 * can see actions taken across the whole office, which is the point of having one.
 */
export class AuditEventPolicy implements Policy<null> {
  readonly resourceType = 'audit-event';

  can(actor: AuthorizationActor, action: string): boolean {
    return actionVerb(action) === 'list' && actor.capabilities.includes(AUDIT_VIEW);
  }
}
