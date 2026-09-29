export const workflowStatuses = [
  'PENDING',
  'IN_PROCESS',
  'FOR_REVISION',
  'FOR_SIGNATURE',
  'SIGNED',
  'FOR_RELEASE',
  'RELEASED',
  'ARCHIVED',
] as const;

export type WorkflowStatus = (typeof workflowStatuses)[number];

export const workflowActions = [
  'ACCEPT',
  'REQUEST_REVISION',
  'RESUBMIT',
  'SUBMIT_FOR_SIGNATURE',
  'SIGN',
  'PREPARE_RELEASE',
  'RELEASE',
  'ARCHIVE',
  'RESTORE',
] as const;

export type WorkflowAction = (typeof workflowActions)[number];
export type DocumentDirection = 'INCOMING' | 'OUTGOING';
export type ReleaseMethod = 'MAILED' | 'EMAILED' | 'PICKED_UP' | 'DELIVERED';

export type WorkflowCapability =
  | 'DOCUMENT_ACCEPT'
  | 'DOCUMENT_REQUEST_REVISION'
  | 'DOCUMENT_RESUBMIT'
  | 'DOCUMENT_SUBMIT_FOR_SIGNATURE'
  | 'DOCUMENT_SIGN'
  | 'DOCUMENT_PREPARE_RELEASE'
  | 'DOCUMENT_RELEASE'
  | 'DOCUMENT_ARCHIVE'
  | 'DOCUMENT_RESTORE';

export interface WorkflowDocument {
  id: string;
  status: WorkflowStatus;
  version: number;
  direction: DocumentDirection;
  hasCleanCurrentAttachment: boolean;
  currentAttachmentVersionId: string | null;
  signedAttachmentVersionId: string | null;
}

export interface WorkflowCommand {
  action: WorkflowAction;
  expectedVersion: number;
  actorId: string;
  remarks?: string;
  releaseMethod?: ReleaseMethod;
}

export interface WorkflowEvent {
  actorId: string;
  action: WorkflowAction;
  fromStatus: WorkflowStatus;
  toStatus: WorkflowStatus;
  remarks: string | null;
  releaseMethod: ReleaseMethod | null;
}

export class IllegalTransitionError extends Error {
  constructor(status: WorkflowStatus, action: WorkflowAction) {
    super(`Action ${action} is not allowed from ${status}`);
    this.name = 'IllegalTransitionError';
  }
}

export class WorkflowConflictError extends Error {
  constructor() {
    super('Document was changed by another user');
    this.name = 'WorkflowConflictError';
  }
}

// A well-formed command that violates a workflow business rule (as opposed to an optimistic
// version conflict or an illegal state transition). Carries a stable machine-readable code
// so the HTTP boundary can surface a precise 422 instead of a masked 500.
export class WorkflowRuleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'WorkflowRuleError';
  }
}

const transitionMatrix: Readonly<
  Record<WorkflowStatus, Partial<Record<WorkflowAction, WorkflowStatus>>>
> = {
  PENDING: { ACCEPT: 'IN_PROCESS' },
  IN_PROCESS: {
    REQUEST_REVISION: 'FOR_REVISION',
    SUBMIT_FOR_SIGNATURE: 'FOR_SIGNATURE',
  },
  FOR_REVISION: { RESUBMIT: 'IN_PROCESS' },
  FOR_SIGNATURE: { REQUEST_REVISION: 'FOR_REVISION', SIGN: 'SIGNED' },
  SIGNED: { PREPARE_RELEASE: 'FOR_RELEASE' },
  FOR_RELEASE: { RELEASE: 'RELEASED' },
  RELEASED: { ARCHIVE: 'ARCHIVED' },
  ARCHIVED: { RESTORE: 'RELEASED' },
};

const actionCapabilities: Readonly<Record<WorkflowAction, WorkflowCapability>> = {
  ACCEPT: 'DOCUMENT_ACCEPT',
  REQUEST_REVISION: 'DOCUMENT_REQUEST_REVISION',
  RESUBMIT: 'DOCUMENT_RESUBMIT',
  SUBMIT_FOR_SIGNATURE: 'DOCUMENT_SUBMIT_FOR_SIGNATURE',
  SIGN: 'DOCUMENT_SIGN',
  PREPARE_RELEASE: 'DOCUMENT_PREPARE_RELEASE',
  RELEASE: 'DOCUMENT_RELEASE',
  ARCHIVE: 'DOCUMENT_ARCHIVE',
  RESTORE: 'DOCUMENT_RESTORE',
};

export class WorkflowService {
  allowedActions(document: WorkflowDocument, capabilities: readonly string[]): WorkflowAction[] {
    const transitions = transitionMatrix[document.status];
    return workflowActions.filter(
      (action) =>
        transitions[action] !== undefined && capabilities.includes(actionCapabilities[action]),
    );
  }

  execute(
    document: WorkflowDocument,
    command: WorkflowCommand,
  ): { document: WorkflowDocument; event: WorkflowEvent } {
    if (document.version !== command.expectedVersion) {
      throw new WorkflowConflictError();
    }

    const toStatus = transitionMatrix[document.status][command.action];
    if (toStatus === undefined) {
      throw new IllegalTransitionError(document.status, command.action);
    }

    const remarks = command.remarks?.trim() ?? '';
    if (command.action === 'REQUEST_REVISION' && remarks.length === 0) {
      throw new WorkflowRuleError('Revision remarks are required', 'REVISION_REMARKS_REQUIRED');
    }

    if (command.action === 'RELEASE') {
      if (command.releaseMethod === undefined) {
        throw new WorkflowRuleError('Release method is required', 'RELEASE_METHOD_REQUIRED');
      }
      if (
        document.direction === 'OUTGOING' &&
        (!document.hasCleanCurrentAttachment ||
          document.currentAttachmentVersionId === null ||
          document.currentAttachmentVersionId !== document.signedAttachmentVersionId)
      ) {
        throw new WorkflowRuleError(
          'Outgoing release requires the current clean attachment to be signed',
          'RELEASE_BLOCKED',
        );
      }
    }

    return {
      document: { ...document, status: toStatus, version: document.version + 1 },
      event: {
        actorId: command.actorId,
        action: command.action,
        fromStatus: document.status,
        toStatus,
        remarks: remarks.length > 0 ? remarks : null,
        releaseMethod: command.releaseMethod ?? null,
      },
    };
  }
}

export const WORKFLOW_TRANSITIONS = transitionMatrix;
export const WORKFLOW_ACTION_CAPABILITIES = actionCapabilities;
