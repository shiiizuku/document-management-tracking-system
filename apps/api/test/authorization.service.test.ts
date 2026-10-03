import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type {
  AuthorizationActor,
  Role,
} from '../src/modules/authorization/authorization.policy.js';
import { AuthorizationService } from '../src/modules/authorization/authorization.service.js';
import type { UserResource } from '../src/modules/authorization/identity.policies.js';
import { capabilitiesByRole } from '../src/modules/authorization/role-capabilities.js';

const service = new AuthorizationService();

const ROLES: Role[] = [
  'ADMINISTRATOR',
  'RECORDS_STAFF',
  'DIRECTOR',
  'DIVISION_HEAD',
  'STAFF_MEMBER',
  'VIEWER',
];

const actor = (role: Role, overrides: Partial<AuthorizationActor> = {}): AuthorizationActor => ({
  id: 'actor-1',
  role,
  divisionId: 'division-a',
  sectionId: 'section-a1',
  capabilities: [...capabilitiesByRole[role]],
  canAccessConfidential: false,
  ...overrides,
});

// A user row in the actor's own division, but never the actor themselves.
const targetUser: UserResource = {
  id: 'target-user',
  role: 'STAFF_MEMBER',
  divisionId: 'division-a',
  sectionId: 'section-a1',
};

// Collection-level (resource-independent) actions and the roles that may perform each. The
// four identity/organization capabilities are administrator-only (policy register P-11), and
// reading the org tree is open to every authenticated role because it feeds the pickers.
const CAPABILITY_MATRIX: { action: string; resource: unknown; allowed: Role[] }[] = [
  { action: 'account-request:list', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'account-request:approve', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'account-request:reject', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'organization:read', resource: null, allowed: ROLES },
  { action: 'organization:create', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'organization:update', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'audit-event:list', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'role:list', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'user:list', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'user:create', resource: null, allowed: ['ADMINISTRATOR'] },
  { action: 'user:update', resource: targetUser, allowed: ['ADMINISTRATOR'] },
  { action: 'user:deactivate', resource: targetUser, allowed: ['ADMINISTRATOR'] },
  { action: 'user:reactivate', resource: targetUser, allowed: ['ADMINISTRATOR'] },
];

describe('AuthorizationService matrix', () => {
  for (const { action, resource, allowed } of CAPABILITY_MATRIX) {
    for (const role of ROLES) {
      const shouldAllow = allowed.includes(role);
      it(`${shouldAllow ? 'allows' : 'denies'} ${role} to ${action}`, () => {
        expect(service.can(actor(role), action, resource)).toBe(shouldAllow);
      });
    }
  }

  it('lets any user read their own record but not a stranger they do not manage', () => {
    const staff = actor('STAFF_MEMBER', { id: 'target-user' });
    expect(service.can(staff, 'user:read', { ...targetUser, id: 'target-user' })).toBe(true);
    // Same staff member, a different user in their own section: still refused without a
    // management capability — section co-membership is a document scope, not a people scope.
    expect(service.can(actor('STAFF_MEMBER'), 'user:read', targetUser)).toBe(false);
  });

  it('lets a division head read a user in their division but not across the boundary', () => {
    const head = actor('DIVISION_HEAD', { divisionId: 'division-a' });
    expect(service.can(head, 'user:read', targetUser)).toBe(true);

    const crossDivisionHead = actor('DIVISION_HEAD', { divisionId: 'division-b' });
    expect(service.can(crossDivisionHead, 'user:read', targetUser)).toBe(false);
  });

  /*
   * The Director reads every *document* but no extra *people*. Open question from the slice-3
   * plan, settled here: the timeline and signature panels resolve actor names through a join
   * inside the scoped document query (`documents.repository.ts`), not through `/users`, so the
   * Director never needs `user:read` to see who signed what. Pinned as a test because the
   * tempting fix for a missing name is to widen this policy instead.
   */
  it('does not widen people-reading for the director', () => {
    const director = actor('DIRECTOR', { divisionId: 'division-ord', sectionId: null });
    expect(service.can(director, 'user:read', targetUser)).toBe(false);
    expect(service.can(director, 'user:list', null)).toBe(false);
  });

  it('refuses to deactivate oneself even as an administrator', () => {
    const admin = actor('ADMINISTRATOR', { id: 'target-user' });
    expect(service.can(admin, 'user:deactivate', { ...targetUser, id: 'target-user' })).toBe(false);
  });

  it('denies by default an unknown action or unregistered resource type', () => {
    const admin = actor('ADMINISTRATOR');
    expect(service.can(admin, 'user:obliterate', targetUser)).toBe(false);
    expect(service.can(admin, 'satellite:launch', null)).toBe(false);
  });

  it('assert turns a refusal into a forbidden error that names no resource', () => {
    expect(() => service.assert(actor('VIEWER'), 'account-request:approve')).toThrow(
      new ForbiddenException('You are not allowed to perform this action'),
    );
    expect(() => service.assert(actor('ADMINISTRATOR'), 'account-request:approve')).not.toThrow();
  });
});
