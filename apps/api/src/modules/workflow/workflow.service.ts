import {
  storedWorkflowStatusSchema,
  workflowActionSchema,
  type DocumentDirection,
  type ReleaseMethod,
  type StoredWorkflowStatus,
  type WorkflowAction,
} from '@dts/contracts';

/*
 * The vocabulary is imported, not declared. It used to be written out here as well as in
 * `@dts/contracts` and in the database schema, and the three copies were kept aligned by hand.
 * `storedWorkflowStatusSchema` excludes `PENDING`, which ADR-0005 makes a derived condition — the
 * existence of an unaccepted route row — rather than a status this engine can move a document into.
 */
export const workflowStatuses = storedWorkflowStatusSchema.options;
export const workflowActions = workflowActionSchema.options;

export type { StoredWorkflowStatus, WorkflowAction, DocumentDirection, ReleaseMethod };

/**
 * What this engine moves a document between.
 *
 * Deliberately the *stored* vocabulary: `PENDING` is a condition derived from unaccepted route
 * rows, not a state anything can transition into or out of. Code that displays or filters a status
 * wants the wider `WorkflowStatus` from `@dts/contracts` instead.
 */
export type WorkflowStatus = StoredWorkflowStatus;

export type WorkflowCapability =
  | 'DOCUMENT_ACCEPT'
  | 'DOCUMENT_REQUEST_REVISION'
  | 'DOCUMENT_RESUBMIT'
  | 'DOCUMENT_INITIAL'
  | 'DOCUMENT_SUBMIT_FOR_SIGNATURE'
  | 'DOCUMENT_SIGN'
  | 'DOCUMENT_PREPARE_RELEASE'
  | 'DOCUMENT_RELEASE'
  | 'DOCUMENT_COMPLY'
  | 'DOCUMENT_ARCHIVE'
  | 'DOCUMENT_RESTORE';

/**
 * One custody hop, as the engine needs to see it.
 *
 * `acceptedAt === null` is the whole point of this type: it is what makes a document pending, and
 * because it is per-row a document handed to three divisions can be accepted by two of them.
 */
export interface RouteCustody {
  id: string;
  toDivisionId: string;
  toSectionId: string | null;
  forInformation: boolean;
  acceptedAt: Date | null;
}

export interface WorkflowActor {
  id: string;
  divisionId: string | null;
  sectionId: string | null;
  capabilities: readonly string[];
}

export interface WorkflowDocument {
  id: string;
  status: WorkflowStatus;
  version: number;
  direction: DocumentDirection;
  /*
   * Whether the document is owned by the Office of the Regional Director. Resolved by the caller
   * and passed in, so this service stays a pure function of its inputs rather than reaching for a
   * repository. It gates exactly one edge — see `edgeConditions`.
   */
  ownerDivisionIsOrd: boolean;
  hasCleanCurrentAttachment: boolean;
  currentAttachmentVersionId: string | null;
  signedAttachmentVersionId: string | null;
  routes: readonly RouteCustody[];
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

/**
 * What a command did. `acceptedRouteId` is set only by `ACCEPT`, which stamps a route row and
 * leaves `documents.status` alone — custody and lifecycle are orthogonal axes (ADR-0005), so an
 * acceptance is not a status transition and does not bump the document's version.
 */
export interface WorkflowOutcome {
  document: WorkflowDocument;
  event: WorkflowEvent;
  acceptedRouteId: string | null;
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

type TransitionTable = Readonly<
  Record<WorkflowStatus, Partial<Record<WorkflowAction, WorkflowStatus>>>
>;

/*
 * Two paths sharing a trunk (decision 38 as amended), not one lifecycle. Outgoing correspondence is
 * drafted, endorsed, signed, released and archived; incoming correspondence is never released — it
 * is complied with. Keying the table by direction is what lets `RESTORE` return an archived
 * document to the terminal state it actually came from (decision 164) instead of asserting that
 * everything was once Released, which would falsify an incoming document's routing slip.
 */
const outgoingTransitions: TransitionTable = {
  IN_PROCESS: {
    REQUEST_REVISION: 'FOR_REVISION',
    INITIAL: 'FOR_INITIAL',
    SUBMIT_FOR_SIGNATURE: 'FOR_SIGNATURE',
  },
  FOR_REVISION: { RESUBMIT: 'IN_PROCESS' },
  FOR_INITIAL: { REQUEST_REVISION: 'FOR_REVISION', SUBMIT_FOR_SIGNATURE: 'FOR_SIGNATURE' },
  FOR_SIGNATURE: { REQUEST_REVISION: 'FOR_REVISION', SIGN: 'SIGNED' },
  SIGNED: { PREPARE_RELEASE: 'FOR_RELEASE' },
  FOR_RELEASE: { RELEASE: 'RELEASED' },
  RELEASED: { ARCHIVE: 'ARCHIVED' },
  COMPLIED: {},
  ARCHIVED: { RESTORE: 'RELEASED' },
};

const incomingTransitions: TransitionTable = {
  IN_PROCESS: { COMPLY: 'COMPLIED' },
  FOR_REVISION: {},
  FOR_INITIAL: {},
  FOR_SIGNATURE: {},
  SIGNED: {},
  FOR_RELEASE: {},
  RELEASED: {},
  COMPLIED: { ARCHIVE: 'ARCHIVED' },
  ARCHIVED: { RESTORE: 'COMPLIED' },
};

const transitionsByDirection: Readonly<Record<DocumentDirection, TransitionTable>> = {
  OUTGOING: outgoingTransitions,
  INCOMING: incomingTransitions,
};

/*
 * Edges that depend on more than (direction, status, action). Keeping them here rather than
 * branching inside `execute` means the table above stays the only decider of *what* is reachable,
 * and this map is the only place a reachable edge is withheld.
 *
 * The one case is the Office of the Regional Director. `FOR_INITIAL` is a division head's
 * endorsement taken before the Director signs (ADR-0006), but the ORD is itself a division that
 * registers outgoing correspondence (decisions 152–153) and its head *is* the Director — so
 * requiring it there would have one person perform both acts, which is precisely what ADR-0006
 * separated. ORD drafts therefore go straight to signature, and every other division's do not.
 * See ADR-0007.
 */
const edgeConditions: Readonly<Record<string, (document: WorkflowDocument) => boolean>> = {
  'IN_PROCESS:SUBMIT_FOR_SIGNATURE': (document) => document.ownerDivisionIsOrd,
  'IN_PROCESS:INITIAL': (document) => !document.ownerDivisionIsOrd,
};

const actionCapabilities: Readonly<Record<WorkflowAction, WorkflowCapability>> = {
  ACCEPT: 'DOCUMENT_ACCEPT',
  REQUEST_REVISION: 'DOCUMENT_REQUEST_REVISION',
  RESUBMIT: 'DOCUMENT_RESUBMIT',
  INITIAL: 'DOCUMENT_INITIAL',
  SUBMIT_FOR_SIGNATURE: 'DOCUMENT_SUBMIT_FOR_SIGNATURE',
  SIGN: 'DOCUMENT_SIGN',
  PREPARE_RELEASE: 'DOCUMENT_PREPARE_RELEASE',
  RELEASE: 'DOCUMENT_RELEASE',
  COMPLY: 'DOCUMENT_COMPLY',
  ARCHIVE: 'DOCUMENT_ARCHIVE',
  RESTORE: 'DOCUMENT_RESTORE',
};

/**
 * The document's lead route — the most recent hop that took custody. A forward names exactly one
 * (decision 159); for-information copies are consulted, never waited on.
 *
 * Exported because this is also the answer to "where is the document now", which
 * `documents.division_id` stopped answering when routing became non-destructive (ADR-0005). The
 * routing service asks it to decide whether a forward is a no-op and what `from_division_id` to
 * stamp on the next hop, and it must be the *same* notion of current custody the engine gates on.
 */
export const leadCustodyRoute = (routes: readonly RouteCustody[]): RouteCustody | undefined =>
  [...routes].reverse().find((route) => !route.forInformation);

const leadRoute = (document: WorkflowDocument): RouteCustody | undefined =>
  leadCustodyRoute(document.routes);

/** Whether the document is pending: any route handed out and not yet taken on (decision 157). */
export const isPending = (document: WorkflowDocument): boolean =>
  document.routes.some((route) => route.acceptedAt === null);

/**
 * Whether progress is blocked. Only the lead route blocks: an unaccepted information copy is an
 * outstanding acknowledgement, never a block (decision 160).
 */
const leadRouteOutstanding = (document: WorkflowDocument): boolean => {
  const lead = leadRoute(document);
  return lead !== undefined && lead.acceptedAt === null;
};

/** The route this actor is the recipient of: its division, and its section where the hop named one. */
const isRecipient = (route: RouteCustody, actor: WorkflowActor): boolean => {
  if (actor.divisionId === null || route.toDivisionId !== actor.divisionId) return false;
  return route.toSectionId === null || route.toSectionId === actor.sectionId;
};

export class WorkflowService {
  /** Every action the vocabulary contains, for exhaustiveness checks in tests and guards. */
  legalActionList(): WorkflowAction[] {
    return [...workflowActions];
  }

  /**
   * The actions this actor may take right now, in this state. The client's action bar is driven
   * entirely by this, so anything missing here is unreachable in the UI — and anything present
   * must survive `execute`, which re-checks every rule.
   */
  allowedActions(document: WorkflowDocument, actor: WorkflowActor): WorkflowAction[] {
    const accept = this.canAcceptCustody(document, actor) ? (['ACCEPT'] as WorkflowAction[]) : [];

    // Nothing moves until the unit holding the document has taken it on (decision 155). Accepting
    // is the one thing still offered, because it is the way out of this state.
    if (leadRouteOutstanding(document)) return accept;

    const transitions = transitionsByDirection[document.direction][document.status];
    const reachable = workflowActions.filter((action) => {
      if (transitions[action] === undefined) return false;
      if (!actor.capabilities.includes(actionCapabilities[action])) return false;
      const condition = edgeConditions[`${document.status}:${action}`];
      return condition === undefined || condition(document);
    });

    return [...accept, ...reachable];
  }

  /** Whether this actor has an outstanding route of their own to take on. */
  private canAcceptCustody(document: WorkflowDocument, actor: WorkflowActor): boolean {
    if (!actor.capabilities.includes('DOCUMENT_ACCEPT')) return false;
    return document.routes.some((route) => route.acceptedAt === null && isRecipient(route, actor));
  }

  execute(
    document: WorkflowDocument,
    actor: WorkflowActor,
    command: WorkflowCommand,
  ): WorkflowOutcome {
    if (document.version !== command.expectedVersion) {
      throw new WorkflowConflictError();
    }

    const remarks = command.remarks?.trim() ?? '';

    if (command.action === 'ACCEPT') {
      return this.acceptCustody(document, actor, command, remarks);
    }

    if (leadRouteOutstanding(document)) {
      throw new WorkflowRuleError(
        'The unit holding this document has not accepted it yet',
        'CUSTODY_NOT_ACCEPTED',
      );
    }

    const toStatus = transitionsByDirection[document.direction][document.status][command.action];
    if (toStatus === undefined) {
      throw new IllegalTransitionError(document.status, command.action);
    }

    const condition = edgeConditions[`${document.status}:${command.action}`];
    if (condition !== undefined && !condition(document)) {
      throw new IllegalTransitionError(document.status, command.action);
    }

    if (command.action === 'REQUEST_REVISION' && remarks.length === 0) {
      throw new WorkflowRuleError('Revision remarks are required', 'REVISION_REMARKS_REQUIRED');
    }

    // An incoming document terminates by being acted upon *with remarks* (decision 163): the
    // remark is what records what was actually done about it, so it is evidence, not a courtesy.
    if (command.action === 'COMPLY' && remarks.length === 0) {
      throw new WorkflowRuleError('Compliance remarks are required', 'COMPLY_REMARKS_REQUIRED');
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
      acceptedRouteId: null,
    };
  }

  /**
   * Records that the actor's unit has taken the document on. Re-entrant by construction: it stamps
   * a route row, so it can happen once per hop — the ORD accepting incoming correspondence, each
   * division accepting what the ORD routed to it, each section accepting what its division
   * assigned (decision 156) — rather than being a single edge out of a `PENDING` status.
   *
   * The status does not move and the document's version is not bumped: nothing on the document row
   * changes. Double-acceptance is caught here for a precise error and again by the conditional
   * `accepted_at IS NULL` update in the repository, which is what makes it race-safe.
   */
  private acceptCustody(
    document: WorkflowDocument,
    actor: WorkflowActor,
    command: WorkflowCommand,
    remarks: string,
  ): WorkflowOutcome {
    const outstanding = document.routes.filter((route) => route.acceptedAt === null);
    if (outstanding.length === 0) {
      throw new WorkflowRuleError(
        'There is nothing outstanding to accept on this document',
        'ROUTE_ALREADY_ACCEPTED',
      );
    }

    const own = outstanding.find((route) => isRecipient(route, actor));
    if (own === undefined) {
      throw new WorkflowRuleError('This document is not awaiting your unit', 'ROUTE_NOT_FOR_ACTOR');
    }

    return {
      document,
      event: {
        actorId: command.actorId,
        action: 'ACCEPT',
        fromStatus: document.status,
        toStatus: document.status,
        remarks: remarks.length > 0 ? remarks : null,
        releaseMethod: null,
      },
      acceptedRouteId: own.id,
    };
  }
}

export const WORKFLOW_TRANSITIONS = transitionsByDirection;
export const WORKFLOW_ACTION_CAPABILITIES = actionCapabilities;
export const WORKFLOW_EDGE_CONDITIONS = edgeConditions;
