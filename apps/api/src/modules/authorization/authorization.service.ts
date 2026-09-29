import { ForbiddenException, Injectable } from '@nestjs/common';
import type { AuthorizationActor } from './authorization.policy.js';
import { actionResourceType, type Policy } from './policy.js';
import {
  AccountRequestPolicy,
  AuditEventPolicy,
  OrganizationPolicy,
  UserPolicy,
  type UserResource,
} from './identity.policies.js';

/**
 * The single entry point for identity, organization and account-request authorization.
 * Deny by default (decision register 89): an action whose resource type has no registered
 * policy, or whose verb the policy does not recognise, is refused rather than allowed
 * through — a typo in an action string fails closed and the matrix test catches it.
 */
@Injectable()
export class AuthorizationService {
  private readonly policies = new Map<string, Policy<never>>(
    [
      new UserPolicy(),
      new AccountRequestPolicy(),
      new OrganizationPolicy(),
      new AuditEventPolicy(),
    ].map((policy) => [policy.resourceType, policy as Policy<never>]),
  );

  can(actor: AuthorizationActor, action: string, resource: unknown = null): boolean {
    const policy = this.policies.get(actionResourceType(action));
    if (policy === undefined) return false;
    return policy.can(actor, action, resource as never);
  }

  /**
   * `can` with the refusal turned into the HTTP response. The message never names the
   * resource or says whether it exists: an actor who may not read a user must not be able to
   * tell a real ID from a guessed one (decision register 97 applied beyond login).
   */
  assert(actor: AuthorizationActor, action: string, resource: unknown = null): void {
    if (!this.can(actor, action, resource)) {
      throw new ForbiddenException('You are not allowed to perform this action');
    }
  }
}

export type { UserResource };
