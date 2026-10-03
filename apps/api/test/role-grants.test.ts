import { describe, expect, it } from 'vitest';
import { roleGrantSchema, roleSchema } from '@dts/contracts';
import { OFFICE_WIDE_READ_ROLES } from '../src/modules/authorization/authorization.policy.js';
import { capabilitiesByRole } from '../src/modules/authorization/role-capabilities.js';
import { roleGrants } from '../src/modules/authorization/role-grants.js';
import { AuthorizationService } from '../src/modules/authorization/authorization.service.js';

/**
 * `GET /roles` serializes the role table rather than restating it, so these assert equality with
 * the table itself: the two can never be maintained separately.
 */
describe('roleGrants', () => {
  const grants = roleGrants();

  it('lists every role once, in roleSchema order', () => {
    expect(grants.map((grant) => grant.role)).toEqual(roleSchema.options);
  });

  it("serves each role's capabilities exactly as the table grants them", () => {
    for (const grant of grants) expect(grant.capabilities).toEqual(capabilitiesByRole[grant.role]);
  });

  it('marks exactly the office-wide readers', () => {
    expect(grants.filter((grant) => grant.readsOfficeWide).map((grant) => grant.role)).toEqual(
      roleSchema.options.filter((role) => OFFICE_WIDE_READ_ROLES.has(role)),
    );
  });

  it('parses against the contract', () => {
    for (const grant of grants) expect(roleGrantSchema.parse(grant)).toEqual(grant);
  });

  it('lets an account-request reviewer read it without user management', () => {
    const reviewer = {
      id: 'reviewer',
      role: 'STAFF_MEMBER' as const,
      divisionId: null,
      sectionId: null,
      capabilities: ['ACCOUNT_REQUEST_REVIEW'],
      canAccessConfidential: false,
    };
    expect(new AuthorizationService().can(reviewer, 'role:list')).toBe(true);
  });
});
