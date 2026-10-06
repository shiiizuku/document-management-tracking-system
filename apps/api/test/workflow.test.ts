import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  WorkflowService,
  WorkflowRuleError,
  type ReleaseCarrier,
  type ReleaseMethodRule,
  type RouteCustody,
  type WorkflowAction,
  type WorkflowActor,
  type WorkflowDocument,
  type WorkflowStatus,
} from '../src/modules/workflow/workflow.service.js';

const DOCUMENT_ID = 'document-1';
const VERSION = 4;

/** A route the actor's own unit is the recipient of, and which it has already taken on. */
const acceptedRoute = (overrides: Partial<RouteCustody> = {}): RouteCustody => ({
  id: 'route-1',
  toDivisionId: 'division-a',
  toSectionId: null,
  forInformation: false,
  acceptedAt: new Date('2026-10-02T08:00:00Z'),
  ...overrides,
});

const actor: WorkflowActor = {
  id: 'user-1',
  divisionId: 'division-a',
  sectionId: 'section-a',
  capabilities: [
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_INITIAL',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_COMPLY',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_RESTORE',
  ],
};

const baseDocument = (
  status: WorkflowStatus,
  overrides: Partial<WorkflowDocument> = {},
): WorkflowDocument => ({
  id: DOCUMENT_ID,
  status,
  version: VERSION,
  direction: 'OUTGOING',
  ownerDivisionIsOrd: false,
  hasCleanCurrentAttachment: false,
  currentAttachmentVersionId: null,
  signedAttachmentVersionId: null,
  // Custody is settled unless a case says otherwise, so a test about the lifecycle is not
  // accidentally also a test about the custody gate.
  routes: [acceptedRoute()],
  ...overrides,
});

/*
 * The two paths in one table (decision 38 as amended). Direction is part of each row because it is
 * part of what makes an edge legal: releasing is an outgoing concern and complying is an incoming
 * one, and RESTORE returns a document to the terminal state its own path actually reached.
 */
const legalTransitions: Array<{
  direction: 'INCOMING' | 'OUTGOING';
  from: WorkflowStatus;
  action: WorkflowAction;
  to: WorkflowStatus;
  ownerDivisionIsOrd?: boolean;
}> = [
  // Outgoing: In Process ↔ For Revision → For Initial → For Signature → Signed → For Release →
  // Released → Archived.
  { direction: 'OUTGOING', from: 'IN_PROCESS', action: 'REQUEST_REVISION', to: 'FOR_REVISION' },
  { direction: 'OUTGOING', from: 'IN_PROCESS', action: 'INITIAL', to: 'FOR_INITIAL' },
  { direction: 'OUTGOING', from: 'FOR_REVISION', action: 'RESUBMIT', to: 'IN_PROCESS' },
  {
    direction: 'OUTGOING',
    from: 'FOR_INITIAL',
    action: 'SUBMIT_FOR_SIGNATURE',
    to: 'FOR_SIGNATURE',
  },
  { direction: 'OUTGOING', from: 'FOR_INITIAL', action: 'REQUEST_REVISION', to: 'FOR_REVISION' },
  { direction: 'OUTGOING', from: 'FOR_SIGNATURE', action: 'REQUEST_REVISION', to: 'FOR_REVISION' },
  { direction: 'OUTGOING', from: 'FOR_SIGNATURE', action: 'SIGN', to: 'SIGNED' },
  { direction: 'OUTGOING', from: 'SIGNED', action: 'PREPARE_RELEASE', to: 'FOR_RELEASE' },
  { direction: 'OUTGOING', from: 'FOR_RELEASE', action: 'RELEASE', to: 'RELEASED' },
  { direction: 'OUTGOING', from: 'RELEASED', action: 'ARCHIVE', to: 'ARCHIVED' },
  { direction: 'OUTGOING', from: 'ARCHIVED', action: 'RESTORE', to: 'RELEASED' },
  // The Office of the Regional Director drafts its own outgoing correspondence and its head is the
  // Director, so an ORD draft is signed without a separate initial (ADR-0007).
  {
    direction: 'OUTGOING',
    from: 'IN_PROCESS',
    action: 'SUBMIT_FOR_SIGNATURE',
    to: 'FOR_SIGNATURE',
    ownerDivisionIsOrd: true,
  },
  /*
   * Incoming: In Process → Complied → Archived, and nothing else. There is deliberately no
   * For Revision here — revision returns *our own draft* for correction, and a letter received
   * from outside the organization is not something the organization revises.
   */
  { direction: 'INCOMING', from: 'IN_PROCESS', action: 'COMPLY', to: 'COMPLIED' },
  { direction: 'INCOMING', from: 'COMPLIED', action: 'ARCHIVE', to: 'ARCHIVED' },
  { direction: 'INCOMING', from: 'ARCHIVED', action: 'RESTORE', to: 'COMPLIED' },
];

const remarksActions: WorkflowAction[] = ['REQUEST_REVISION', 'COMPLY'];

/*
 * Release methods and carriers are configured rows, not enum values, and the engine is handed the
 * resolved rows so it can read their own `requiresCarrier` and `requiresTrackingReference` flags
 * (policy register P-15). `EMAILED` is the one used throughout here precisely because it takes
 * neither a carrier nor a tracking reference; Mailed has its own cases below.
 */
const EMAILED: ReleaseMethodRule = {
  id: 'release-method-emailed',
  code: 'EMAILED',
  label: 'Emailed',
  requiresCarrier: false,
};
const MAILED: ReleaseMethodRule = {
  id: 'release-method-mailed',
  code: 'MAILED',
  label: 'Mailed',
  requiresCarrier: true,
};
const POSTAL: ReleaseCarrier = {
  id: 'release-carrier-postal',
  code: 'POSTAL',
  label: 'Postal',
  requiresTrackingReference: true,
};
const LBC: ReleaseCarrier = {
  id: 'release-carrier-lbc',
  code: 'LBC',
  label: 'LBC',
  requiresTrackingReference: true,
};

const commandFor = (action: WorkflowAction) => ({
  action,
  expectedVersion: VERSION,
  actorId: 'user-1',
  ...(remarksActions.includes(action) ? { remarks: 'Noted.' } : {}),
  ...(action === 'RELEASE' ? { releaseMethod: EMAILED } : {}),
});

const documentFor = (entry: (typeof legalTransitions)[number]): WorkflowDocument => {
  const document = baseDocument(entry.from, { direction: entry.direction });
  if (entry.ownerDivisionIsOrd) document.ownerDivisionIsOrd = true;
  /*
   * Release needs the current attachment to be the signed one (decision 37). Set unconditionally
   * for the RELEASE action, including on an incoming document — the illegality sweep below reuses
   * this helper, and silently flipping the direction to make the rule pass would stop that sweep
   * from ever testing that an incoming document cannot be released.
   */
  if (entry.action === 'RELEASE') {
    document.hasCleanCurrentAttachment = true;
    document.currentAttachmentVersionId = 'file-v1';
    document.signedAttachmentVersionId = 'file-v1';
  }
  return document;
};

describe('WorkflowService public seam', () => {
  const workflow = new WorkflowService();

  it.each(legalTransitions)(
    '$direction: $from --$action--> $to',
    ({ from, action, to, ...entry }) => {
      const result = workflow.execute(
        documentFor({ from, action, to, ...entry }),
        actor,
        commandFor(action),
      );

      expect(result.document).toMatchObject({ status: to, version: VERSION + 1 });
      expect(result.event).toMatchObject({
        actorId: 'user-1',
        action,
        fromStatus: from,
        toStatus: to,
      });
    },
  );

  it('advances the version on every lifecycle transition, including the end of an incoming path', () => {
    for (const entry of legalTransitions) {
      const result = workflow.execute(documentFor(entry), actor, commandFor(entry.action));
      expect(result.document.version).toBe(VERSION + 1);
    }
  });

  it('rejects every action not legal for the current state on that direction', () => {
    for (const direction of ['INCOMING', 'OUTGOING'] as const) {
      for (const status of [
        'IN_PROCESS',
        'FOR_REVISION',
        'FOR_INITIAL',
        'FOR_SIGNATURE',
        'SIGNED',
        'FOR_RELEASE',
        'RELEASED',
        'COMPLIED',
        'ARCHIVED',
      ] as WorkflowStatus[]) {
        for (const ownerDivisionIsOrd of [false, true]) {
          const legalActions = legalTransitions
            .filter((entry) => entry.from === status && entry.direction === direction)
            .filter(
              (entry) =>
                entry.ownerDivisionIsOrd === undefined ||
                entry.ownerDivisionIsOrd === ownerDivisionIsOrd,
            )
            .map((entry) => entry.action);

          for (const action of workflow.legalActionList()) {
            // ACCEPT and ACKNOWLEDGE stamp a route rather than move a state, so they are legal
            // exactly while the actor has an outstanding hop — covered by their own cases below.
            if (action === 'ACCEPT' || action === 'ACKNOWLEDGE' || legalActions.includes(action))
              continue;
            expect(
              () =>
                workflow.execute(
                  documentFor({ direction, from: status, action, to: status, ownerDivisionIsOrd }),
                  actor,
                  commandFor(action),
                ),
              `${direction} ${status} --${action}--> should be illegal`,
            ).toThrow(IllegalTransitionError);
          }
        }
      }
    }
  });

  it('requires nonblank remarks when requesting revision', () => {
    expect(() =>
      workflow.execute(baseDocument('IN_PROCESS'), actor, {
        action: 'REQUEST_REVISION',
        expectedVersion: VERSION,
        actorId: 'user-1',
        remarks: '   ',
      }),
    ).toThrowError('Revision remarks are required');
  });

  /*
   * Complied is the incoming terminal, and the remark is what records what was done about the
   * correspondence (decision 163). Without one the state would claim the document was acted upon
   * while saying nothing about how, which is not evidence.
   */
  it('requires nonblank remarks when complying an incoming document', () => {
    const incoming = baseDocument('IN_PROCESS', { direction: 'INCOMING' });
    expect(() =>
      workflow.execute(incoming, actor, {
        action: 'COMPLY',
        expectedVersion: VERSION,
        actorId: 'user-1',
        remarks: '  ',
      }),
    ).toThrowError('Compliance remarks are required');

    expect(
      workflow.execute(incoming, actor, {
        action: 'COMPLY',
        expectedVersion: VERSION,
        actorId: 'user-1',
        remarks: 'Referred to the planning officer.',
      }).document.status,
    ).toBe('COMPLIED');
  });

  it('rejects stale aggregate versions', () => {
    expect(() =>
      workflow.execute(baseDocument('IN_PROCESS'), actor, {
        action: 'INITIAL',
        expectedVersion: 3,
        actorId: 'user-1',
      }),
    ).toThrowError('Document was changed by another user');
  });

  it('requires a clean current attachment signed at that same version before outgoing release', () => {
    const invalid = {
      ...baseDocument('FOR_RELEASE'),
      hasCleanCurrentAttachment: true,
      currentAttachmentVersionId: 'file-v2',
      signedAttachmentVersionId: 'file-v1',
    };

    expect(() =>
      workflow.execute(invalid, actor, {
        action: 'RELEASE',
        expectedVersion: VERSION,
        actorId: 'records-1',
        releaseMethod: EMAILED,
      }),
    ).toThrowError('Outgoing release requires the current clean attachment to be signed');
  });

  /*
   * P-15 as decided 2026-10-06: Mailed asks for a carrier, and every carrier asks for a tracking
   * reference. Both rules read off the rows' flags rather than lists of codes, so these cases are
   * what stop a fourth carrier needing a change to the engine.
   */
  describe('carriers and tracking references', () => {
    const releasable = {
      ...baseDocument('FOR_RELEASE'),
      hasCleanCurrentAttachment: true,
      currentAttachmentVersionId: 'file-v1',
      signedAttachmentVersionId: 'file-v1',
    };
    const release = (extra: Partial<Parameters<typeof workflow.execute>[2]>) =>
      workflow.execute(releasable, actor, {
        action: 'RELEASE',
        expectedVersion: VERSION,
        actorId: 'records-1',
        ...extra,
      });

    it('refuses a mailed release with no carrier', () => {
      expect(() => release({ releaseMethod: MAILED, trackingReference: 'X-1' })).toThrowError(
        'Mailed requires a carrier',
      );
    });

    it('refuses a carrier on a method that does not take one', () => {
      expect(() => release({ releaseMethod: EMAILED, releaseCarrier: LBC })).toThrowError(
        'Emailed does not take a carrier',
      );
    });

    it('refuses a mailed release with no tracking reference, Postal included', () => {
      expect(() => release({ releaseMethod: MAILED, releaseCarrier: LBC })).toThrowError(
        'LBC requires a tracking reference',
      );
      expect(() => release({ releaseMethod: MAILED, releaseCarrier: POSTAL })).toThrowError(
        'Postal requires a tracking reference',
      );
    });

    it('records the carrier and tracking reference a mailed release carries', () => {
      const outcome = release({
        releaseMethod: MAILED,
        releaseCarrier: POSTAL,
        trackingReference: ' RR123456789PH ',
      });
      expect(outcome.event).toMatchObject({
        releaseMethod: MAILED,
        releaseCarrier: POSTAL,
        trackingReference: 'RR123456789PH',
      });
    });

    /*
     * The converse, and it is a refusal rather than a silent drop: a tracking number against
     * "Emailed" asserts that something can be traced when it cannot, and discarding it would
     * leave whoever typed it believing otherwise.
     */
    it('refuses a tracking reference on a method that does not take one', () => {
      expect(() =>
        release({ releaseMethod: EMAILED, trackingReference: 'LBC-00042' }),
      ).toThrowError('Emailed does not take a tracking reference');
    });
  });

  it('publishes actor-filtered allowed actions', () => {
    const document = baseDocument('IN_PROCESS');
    expect(workflow.allowedActions(document, actor)).toEqual(['REQUEST_REVISION', 'INITIAL']);
    // A viewer — or anyone whose role grants no document capability — is offered nothing.
    expect(workflow.allowedActions(document, { ...actor, capabilities: [] })).toEqual([]);
  });

  it('offers the ORD draft a direct route to signature instead of an initial', () => {
    const ordDraft = baseDocument('IN_PROCESS', { ownerDivisionIsOrd: true });
    expect(workflow.allowedActions(ordDraft, actor)).toEqual([
      'REQUEST_REVISION',
      'SUBMIT_FOR_SIGNATURE',
    ]);
  });
});

/*
 * ADR-0005 records these four custody cases as the ones the revision must not get wrong. They are
 * the reason acceptance is a fact on the route rather than a status: each is expressible only
 * because the hop carries its own receipt.
 */
describe('WorkflowService custody acceptance', () => {
  const workflow = new WorkflowService();

  it('accepts a route the actor’s unit is the recipient of, and moves no status', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ id: 'route-incoming', acceptedAt: null })],
    });

    const result = workflow.execute(document, actor, {
      action: 'ACCEPT',
      expectedVersion: VERSION,
      actorId: 'user-1',
      remarks: 'Received.',
    });

    expect(result.acceptedRouteId).toBe('route-incoming');
    // Custody and lifecycle are orthogonal: nothing on the document row changes, so neither does
    // its status or its version.
    expect(result.document.status).toBe('IN_PROCESS');
    expect(result.document.version).toBe(VERSION);
    expect(result.event).toMatchObject({
      action: 'ACCEPT',
      fromStatus: 'IN_PROCESS',
      toStatus: 'IN_PROCESS',
    });
  });

  it('refuses a route addressed to another unit', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ acceptedAt: null, toDivisionId: 'division-b' })],
    });

    expect(() =>
      workflow.execute(document, actor, {
        action: 'ACCEPT',
        expectedVersion: VERSION,
        actorId: 'user-1',
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'ROUTE_NOT_FOR_ACTOR',
        name: WorkflowRuleError.name,
      }),
    );
  });

  it('refuses a second acceptance of the same hop', () => {
    const document = baseDocument('IN_PROCESS', { routes: [acceptedRoute()] });

    expect(() =>
      workflow.execute(document, actor, {
        action: 'ACCEPT',
        expectedVersion: VERSION,
        actorId: 'user-1',
      }),
    ).toThrowError(expect.objectContaining({ code: 'ROUTE_ALREADY_ACCEPTED' }));
  });

  it('blocks every other action while the lead route is outstanding, and offers ACCEPT', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ acceptedAt: null })],
    });

    expect(workflow.allowedActions(document, actor)).toEqual(['ACCEPT']);
    expect(() =>
      workflow.execute(document, actor, {
        action: 'INITIAL',
        expectedVersion: VERSION,
        actorId: 'user-1',
      }),
    ).toThrowError(expect.objectContaining({ code: 'CUSTODY_NOT_ACCEPTED' }));
  });

  /*
   * A forward names one lead and any number of for-information recipients. The lead gates progress;
   * an information copy is an outstanding acknowledgement, never a block (decision 160).
   */
  it('does not block progress on an unaccepted for-information copy', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [
        acceptedRoute(),
        acceptedRoute({
          id: 'route-fyi',
          toDivisionId: 'division-b',
          forInformation: true,
          acceptedAt: null,
        }),
      ],
    });

    expect(
      workflow.execute(document, actor, {
        action: 'INITIAL',
        expectedVersion: VERSION,
        actorId: 'user-1',
      }).document.status,
    ).toBe('FOR_INITIAL');
  });

  /*
   * A document routed to several divisions at once — the case a single status column could not
   * express (ADR-0005, decision 24).
   */
  it('lets parallel recipients accept independently of one another', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [
        acceptedRoute(),
        acceptedRoute({ id: 'route-b', toDivisionId: 'division-b', acceptedAt: null }),
      ],
    });

    const otherActor: WorkflowActor = {
      ...actor,
      id: 'user-2',
      divisionId: 'division-b',
    };

    expect(workflow.allowedActions(document, actor)).not.toContain('ACCEPT');
    expect(workflow.allowedActions(document, otherActor)).toEqual(['ACCEPT']);

    const result = workflow.execute(document, otherActor, {
      action: 'ACCEPT',
      expectedVersion: VERSION,
      actorId: 'user-2',
    });
    expect(result.acceptedRouteId).toBe('route-b');
  });
});

/*
 * A for-information copy is acknowledged, not accepted (ADR-0005, decision 160). Each action stamps
 * only its own kind of hop: before the split, ACCEPT matched any outstanding hop to the actor's
 * unit, so a copy offered "Accept custody" and a unit that was both lead and copied in could stamp
 * the copy and leave its custody hop outstanding.
 */
describe('WorkflowService copy acknowledgement', () => {
  const workflow = new WorkflowService();
  const copy = (overrides: Partial<RouteCustody> = {}): RouteCustody =>
    acceptedRoute({ id: 'route-copy', forInformation: true, acceptedAt: null, ...overrides });
  const command = (action: 'ACCEPT' | 'ACKNOWLEDGE') => ({
    action,
    expectedVersion: VERSION,
    actorId: 'user-1',
  });

  it('offers ACKNOWLEDGE and not ACCEPT on an outstanding copy', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ toDivisionId: 'division-b' }), copy()],
    });

    const allowed = workflow.allowedActions(document, actor);
    expect(allowed).toContain('ACKNOWLEDGE');
    expect(allowed).not.toContain('ACCEPT');
  });

  it('offers ACCEPT and not ACKNOWLEDGE on an outstanding lead hop', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ acceptedAt: null })],
    });

    expect(workflow.allowedActions(document, actor)).toEqual(['ACCEPT']);
  });

  it('stamps the copy, and moves no status', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ toDivisionId: 'division-b' }), copy()],
    });

    const result = workflow.execute(document, actor, command('ACKNOWLEDGE'));
    expect(result.acceptedRouteId).toBe('route-copy');
    expect(result.document.version).toBe(VERSION);
    expect(result.event).toMatchObject({
      action: 'ACKNOWLEDGE',
      fromStatus: 'IN_PROCESS',
      toStatus: 'IN_PROCESS',
    });
  });

  it('refuses ACCEPT on a copy', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ toDivisionId: 'division-b' }), copy()],
    });

    expect(() => workflow.execute(document, actor, command('ACCEPT'))).toThrowError(
      expect.objectContaining({ code: 'ROUTE_ALREADY_ACCEPTED' }),
    );
  });

  it('keeps the lead hop and the copy apart for a unit that holds both', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [
        copy({ id: 'route-copy-older' }),
        acceptedRoute({ id: 'route-lead', acceptedAt: null }),
      ],
    });

    expect(workflow.allowedActions(document, actor)).toEqual(['ACCEPT', 'ACKNOWLEDGE']);
    expect(workflow.execute(document, actor, command('ACCEPT')).acceptedRouteId).toBe('route-lead');
    expect(workflow.execute(document, actor, command('ACKNOWLEDGE')).acceptedRouteId).toBe(
      'route-copy-older',
    );
  });

  // A copy never waits on the lead: the informed division may acknowledge before custody is taken.
  it('offers ACKNOWLEDGE while the lead hop is still outstanding elsewhere', () => {
    const document = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute({ toDivisionId: 'division-b', acceptedAt: null }), copy()],
    });

    expect(workflow.allowedActions(document, actor)).toEqual(['ACKNOWLEDGE']);
    expect(workflow.execute(document, actor, command('ACKNOWLEDGE')).acceptedRouteId).toBe(
      'route-copy',
    );
  });

  it('refuses a second acknowledgement, and one from a unit that was not copied', () => {
    const acknowledged = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute(), copy({ acceptedAt: new Date('2026-10-03T08:00:00Z') })],
    });
    expect(() => workflow.execute(acknowledged, actor, command('ACKNOWLEDGE'))).toThrowError(
      expect.objectContaining({ code: 'ROUTE_ALREADY_ACCEPTED' }),
    );

    const elsewhere = baseDocument('IN_PROCESS', {
      routes: [acceptedRoute(), copy({ toDivisionId: 'division-b' })],
    });
    expect(workflow.allowedActions(elsewhere, actor)).not.toContain('ACKNOWLEDGE');
    expect(() => workflow.execute(elsewhere, actor, command('ACKNOWLEDGE'))).toThrowError(
      expect.objectContaining({ code: 'ROUTE_NOT_FOR_ACTOR' }),
    );
  });
});
