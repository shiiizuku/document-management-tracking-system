import { describe, expect, it } from 'vitest';
import {
  IllegalTransitionError,
  WorkflowService,
  type WorkflowAction,
  type WorkflowDocument,
  type WorkflowStatus,
} from '../src/modules/workflow/workflow.service.js';

const legalTransitions: Array<{
  from: WorkflowStatus;
  action: WorkflowAction;
  to: WorkflowStatus;
}> = [
  { from: 'PENDING', action: 'ACCEPT', to: 'IN_PROCESS' },
  { from: 'IN_PROCESS', action: 'REQUEST_REVISION', to: 'FOR_REVISION' },
  { from: 'FOR_REVISION', action: 'RESUBMIT', to: 'IN_PROCESS' },
  { from: 'IN_PROCESS', action: 'SUBMIT_FOR_SIGNATURE', to: 'FOR_SIGNATURE' },
  { from: 'FOR_SIGNATURE', action: 'REQUEST_REVISION', to: 'FOR_REVISION' },
  { from: 'FOR_SIGNATURE', action: 'SIGN', to: 'SIGNED' },
  { from: 'SIGNED', action: 'PREPARE_RELEASE', to: 'FOR_RELEASE' },
  { from: 'FOR_RELEASE', action: 'RELEASE', to: 'RELEASED' },
  { from: 'RELEASED', action: 'ARCHIVE', to: 'ARCHIVED' },
  { from: 'ARCHIVED', action: 'RESTORE', to: 'RELEASED' },
];

const baseDocument = (status: WorkflowStatus): WorkflowDocument => ({
  id: 'document-1',
  status,
  version: 4,
  direction: 'INCOMING',
  hasCleanCurrentAttachment: false,
  currentAttachmentVersionId: null,
  signedAttachmentVersionId: null,
});

describe('WorkflowService public seam', () => {
  const workflow = new WorkflowService();

  it.each(legalTransitions)('$from --$action--> $to', ({ from, action, to }) => {
    const result = workflow.execute(baseDocument(from), {
      action,
      expectedVersion: 4,
      actorId: 'user-1',
      ...(action === 'REQUEST_REVISION' ? { remarks: 'Please correct the addressee.' } : {}),
      ...(action === 'RELEASE' ? { releaseMethod: 'EMAILED' as const } : {}),
    });

    expect(result.document).toMatchObject({ status: to, version: 5 });
    expect(result.event).toMatchObject({
      actorId: 'user-1',
      action,
      fromStatus: from,
      toStatus: to,
    });
  });

  it('rejects every action not legal for the current state', () => {
    const allActions: WorkflowAction[] = [
      'ACCEPT',
      'REQUEST_REVISION',
      'RESUBMIT',
      'SUBMIT_FOR_SIGNATURE',
      'SIGN',
      'PREPARE_RELEASE',
      'RELEASE',
      'ARCHIVE',
      'RESTORE',
    ];

    for (const status of [
      'PENDING',
      'IN_PROCESS',
      'FOR_REVISION',
      'FOR_SIGNATURE',
      'SIGNED',
      'FOR_RELEASE',
      'RELEASED',
      'ARCHIVED',
    ] as WorkflowStatus[]) {
      const legalActions = legalTransitions
        .filter((entry) => entry.from === status)
        .map((entry) => entry.action);
      for (const action of allActions.filter((candidate) => !legalActions.includes(candidate))) {
        expect(() =>
          workflow.execute(baseDocument(status), {
            action,
            expectedVersion: 4,
            actorId: 'user-1',
          }),
        ).toThrow(IllegalTransitionError);
      }
    }
  });

  it('requires nonblank remarks when requesting revision', () => {
    expect(() =>
      workflow.execute(baseDocument('IN_PROCESS'), {
        action: 'REQUEST_REVISION',
        expectedVersion: 4,
        actorId: 'user-1',
        remarks: '   ',
      }),
    ).toThrowError('Revision remarks are required');
  });

  it('rejects stale aggregate versions', () => {
    expect(() =>
      workflow.execute(baseDocument('PENDING'), {
        action: 'ACCEPT',
        expectedVersion: 3,
        actorId: 'user-1',
      }),
    ).toThrowError('Document was changed by another user');
  });

  it('requires a clean current attachment signed at that same version before outgoing release', () => {
    const invalid = {
      ...baseDocument('FOR_RELEASE'),
      direction: 'OUTGOING' as const,
      hasCleanCurrentAttachment: true,
      currentAttachmentVersionId: 'file-v2',
      signedAttachmentVersionId: 'file-v1',
    };

    expect(() =>
      workflow.execute(invalid, {
        action: 'RELEASE',
        expectedVersion: 4,
        actorId: 'records-1',
        releaseMethod: 'EMAILED',
      }),
    ).toThrowError('Outgoing release requires the current clean attachment to be signed');
  });

  it('publishes actor-filtered allowed actions', () => {
    expect(workflow.allowedActions(baseDocument('PENDING'), ['DOCUMENT_ACCEPT'])).toEqual([
      'ACCEPT',
    ]);
    expect(workflow.allowedActions(baseDocument('PENDING'), [])).toEqual([]);
  });
});
