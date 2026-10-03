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
  routes: [],
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

  /*
   * Route-derived placement scope (ADR-0005). `divisionId` on the resource is now where the
   * document was *registered* and never moves, so a forwarded document matches nothing on the row
   * itself — the receiving unit's claim to it is a route row, and these cases are what stop that
   * claim from being dropped. The SQL twin of each is asserted in `query-scope.int.test.ts`.
   */
  describe('placement through custody hops', () => {
    // Registered in Division A / Section A1, then forwarded to Division B / Section B1.
    const forwarded: AuthorizationResource = {
      ...resource,
      assigneeUserIds: [],
      sharedUserIds: [],
      routes: [{ toDivisionId: 'division-b', toSectionId: 'section-b1', forInformation: false }],
    };

    it('reaches the section the document was forwarded to', () => {
      expect(
        policy.canRead(actor({ divisionId: 'division-b', sectionId: 'section-b1' }), forwarded),
      ).toBe(true);
    });

    it('does not reach a sibling section in the receiving division', () => {
      expect(
        policy.canRead(actor({ divisionId: 'division-b', sectionId: 'section-b2' }), forwarded),
      ).toBe(false);
    });

    it('reaches the head of the receiving division', () => {
      expect(
        policy.canRead(
          actor({ role: 'DIVISION_HEAD', divisionId: 'division-b', sectionId: null }),
          forwarded,
        ),
      ).toBe(true);
    });

    /*
     * Decision 180: a forward to the division as a whole is handed to every section in it — the
     * same people it notifies — while a forward naming a section still skips its siblings.
     */
    it('reaches every section of a division forwarded to as a whole', () => {
      const divisionWide: AuthorizationResource = {
        ...forwarded,
        routes: [{ toDivisionId: 'division-b', toSectionId: null, forInformation: false }],
      };
      expect(
        policy.canRead(actor({ divisionId: 'division-b', sectionId: 'section-b1' }), divisionWide),
      ).toBe(true);
      expect(
        policy.canRead(actor({ divisionId: 'division-b', sectionId: 'section-b2' }), divisionWide),
      ).toBe(true);
      expect(
        policy.canRead(actor({ divisionId: 'division-c', sectionId: 'section-c1' }), divisionWide),
      ).toBe(false);
    });

    /*
     * Decision 176: forwarding is non-destructive, so the unit that handled a document keeps it.
     * Nothing in the predicate says so — the hop by which Section A1 received the document is
     * still on record, and that is the whole mechanism. Pinned because the behaviour it replaces
     * did the opposite: `relocate` moved the column and the sender lost the document.
     */
    it('keeps the forwarding unit on a document it has passed onward', () => {
      const onward: AuthorizationResource = {
        ...forwarded,
        routes: [
          { toDivisionId: 'division-a', toSectionId: 'section-a1', forInformation: false },
          ...forwarded.routes,
        ],
      };
      expect(
        policy.canRead(actor({ divisionId: 'division-a', sectionId: 'section-a1' }), onward),
      ).toBe(true);
    });

    /*
     * A copy for information is division-level by decision 160: it reaches the division head and
     * not every section inside the division, which is what "consulted" means as distinct from
     * "handed to".
     */
    it('reaches a copied-in division head but not that division’s sections', () => {
      const copied: AuthorizationResource = {
        ...forwarded,
        routes: [
          ...forwarded.routes,
          { toDivisionId: 'division-c', toSectionId: null, forInformation: true },
        ],
      };
      expect(
        policy.canRead(
          actor({ role: 'DIVISION_HEAD', divisionId: 'division-c', sectionId: null }),
          copied,
        ),
      ).toBe(true);
      expect(
        policy.canRead(actor({ divisionId: 'division-c', sectionId: 'section-c1' }), copied),
      ).toBe(false);
    });

    /*
     * Acceptance is deliberately not part of this predicate — a recipient who could not read a
     * document could never accept it. `RouteRecipient` carries no `acceptedAt` for exactly that
     * reason, so the only way to assert the rule is that an unaccepted hop (every hop here is one:
     * there is no field to accept) reaches its recipient.
     */
    it('reaches a recipient before the hop is accepted', () => {
      expect(
        policy.can(
          actor({
            divisionId: 'division-b',
            sectionId: 'section-b1',
            capabilities: ['DOCUMENT_ACCEPT'],
          }),
          forwarded,
          'DOCUMENT_ACCEPT',
        ),
      ).toBe(true);
    });
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
