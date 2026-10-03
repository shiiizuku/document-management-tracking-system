import { describe, expect, it } from 'vitest';
import {
  AuthorizationPolicy,
  type AuthorizationActor,
  type AuthorizationResource,
} from '../src/modules/authorization/authorization.policy.js';

const resource: AuthorizationResource = {
  id: 'document-1',
  divisionId: 'division-a',
  sectionId: 'section-a1',
  assigneeUserIds: ['assigned-user'],
  sharedUserIds: ['shared-user'],
  confidential: false,
};

const actor = (overrides: Partial<AuthorizationActor>): AuthorizationActor => ({
  id: 'user-1',
  role: 'STAFF_MEMBER',
  divisionId: 'division-a',
  sectionId: 'section-a1',
  capabilities: [],
  canAccessConfidential: false,
  ...overrides,
});

describe('AuthorizationPolicy public seam', () => {
  const policy = new AuthorizationPolicy();

  it('gives administrators and records staff organization-wide document visibility', () => {
    expect(policy.canRead(actor({ role: 'ADMINISTRATOR', divisionId: 'other' }), resource)).toBe(
      true,
    );
    expect(policy.canRead(actor({ role: 'RECORDS_STAFF', divisionId: 'other' }), resource)).toBe(
      true,
    );
  });

  /*
   * The Director reads the whole office in order to review what it signs (ADR-0006), while still
   * being *placed* in the ORD — the first role for which a division is required and yet narrows
   * nothing. The confidentiality gate is the one thing the role does not override, which is what
   * keeps it from collapsing into an administrator.
   */
  it('gives the director office-wide visibility without waiving confidentiality', () => {
    const director = actor({ role: 'DIRECTOR', divisionId: 'division-ord', sectionId: null });
    expect(policy.canRead(director, resource)).toBe(true);
    expect(policy.canRead(director, { ...resource, confidential: true })).toBe(false);
    expect(
      policy.canRead(
        { ...director, canAccessConfidential: true },
        { ...resource, confidential: true },
      ),
    ).toBe(true);
  });

  it('limits division heads to their division or explicit shares', () => {
    expect(
      policy.canRead(actor({ role: 'DIVISION_HEAD', divisionId: 'division-a' }), resource),
    ).toBe(true);
    expect(
      policy.canRead(actor({ role: 'DIVISION_HEAD', divisionId: 'division-b' }), resource),
    ).toBe(false);
    expect(
      policy.canRead(
        actor({ id: 'shared-user', role: 'DIVISION_HEAD', divisionId: 'division-b' }),
        resource,
      ),
    ).toBe(true);
  });

  it('limits staff to their section, assignment, or explicit share', () => {
    expect(policy.canRead(actor({ sectionId: 'section-a1' }), resource)).toBe(true);
    expect(policy.canRead(actor({ sectionId: 'section-a2' }), resource)).toBe(false);
    expect(
      policy.canRead(
        actor({ id: 'assigned-user', divisionId: 'division-b', sectionId: 'b1' }),
        resource,
      ),
    ).toBe(true);
  });

  it('keeps viewers read-only even when the document is in scope', () => {
    const viewer = actor({ role: 'VIEWER', capabilities: ['DOCUMENT_EDIT'] });
    expect(policy.canRead(viewer, resource)).toBe(true);
    expect(policy.can(viewer, resource, 'DOCUMENT_EDIT')).toBe(false);
  });

  it('requires explicit confidential access in addition to ordinary scope', () => {
    const confidential = { ...resource, confidential: true };
    expect(policy.canRead(actor({ role: 'RECORDS_STAFF' }), confidential)).toBe(false);
    expect(
      policy.canRead(actor({ role: 'RECORDS_STAFF', canAccessConfidential: true }), confidential),
    ).toBe(true);
  });

  it('requires both scope and capability for mutation', () => {
    expect(policy.can(actor({ capabilities: ['DOCUMENT_EDIT'] }), resource, 'DOCUMENT_EDIT')).toBe(
      true,
    );
    expect(
      policy.can(
        actor({
          divisionId: 'division-b',
          sectionId: 'section-b1',
          capabilities: ['DOCUMENT_EDIT'],
        }),
        resource,
        'DOCUMENT_EDIT',
      ),
    ).toBe(false);
    expect(policy.can(actor({ capabilities: [] }), resource, 'DOCUMENT_EDIT')).toBe(false);
  });

  it('filters lists before pagination and counting', () => {
    const visible = resource;
    const hidden = {
      ...resource,
      id: 'document-2',
      divisionId: 'division-b',
      sectionId: 'section-b1',
    };
    expect(policy.filterReadable(actor({}), [visible, hidden]).map((entry) => entry.id)).toEqual([
      'document-1',
    ]);
  });
});
