import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  CreateDocumentInput,
  RouteDocumentInput,
  UpdateDocumentMetadataInput,
} from '@dts/contracts';
import type { RequestUser } from '../../common/request-user.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { OutboxWriter } from '../audit/outbox.writer.js';
import {
  AuthorizationPolicy,
  type AuthorizationResource,
} from '../authorization/authorization.policy.js';
import { NotificationsRepository } from '../notifications/notifications.repository.js';
import type { MonthlyReport } from '../reports/monthly-report.js';
import { UsersRepository } from '../users/users.repository.js';
import { FileVersionsRepository } from '../files/file-versions.repository.js';
import {
  IllegalTransitionError,
  leadCustodyRoute,
  WORKFLOW_ACTION_CAPABILITIES,
  WorkflowConflictError,
  WorkflowRuleError,
  WorkflowService,
  type ReleaseMethod,
  type WorkflowAction,
  type WorkflowActor,
  type WorkflowDocument,
  type RouteCustody,
} from '../workflow/workflow.service.js';
// The presented vocabulary, which includes the derived `PENDING`; see `TimelineEntry`.
import type { WorkflowStatus } from '@dts/contracts';
import {
  DocumentsRepository,
  type DashboardActivityEntry,
  type DashboardCounts,
  type DashboardDivisionPending,
  type DocumentAuthorizationFacts,
  type DocumentMetadataPatch,
  type DocumentRow,
  type DocumentRouteRow,
  type DocumentSearchFilters,
} from './documents.repository.js';

/** The wire shape of a document row. Built by hand so a column added later is never served by accident. */
export interface PublicDocument {
  id: string;
  trackingNumber: string;
  referenceNumber: string | null;
  title: string;
  type: string;
  description: string | null;
  priority: DocumentRow['priority'];
  direction: DocumentRow['direction'];
  status: DocumentRow['status'];
  sender: string | null;
  company: string | null;
  email: string | null;
  divisionId: string;
  sectionId: string | null;
  createdById: string;
  confidential: boolean;
  dueAt: Date | null;
  version: number;
  // Named for the API/UI (the "attachment" vocabulary), aliasing the row's file-version
  // columns; `hasCleanCurrentAttachment` is derived from the scan store, `releaseMethod` from
  // the release event (only populated where it has been loaded, otherwise null).
  currentAttachmentVersionId: string | null;
  signedAttachmentVersionId: string | null;
  hasCleanCurrentAttachment: boolean;
  releaseMethod: ReleaseMethod | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TimelineEntry {
  id: string;
  sequence: number;
  actorId: string;
  action: string;
  /*
   * Read as the presented vocabulary, not as the column's. `workflow_events` preserves the status
   * names that were in force when the event happened, so a hop recorded before the 2026-10-02
   * revision still says `PENDING` — which is a truthful account of that moment and is why these
   * columns are free text rather than the live enum.
   */
  fromStatus: WorkflowStatus | null;
  toStatus: WorkflowStatus;
  remarks: string | null;
  occurredAt: Date;
}

export interface MetadataRevisionEntry {
  id: string;
  actorId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  occurredAt: Date;
}

export interface RouteEntry {
  id: string;
  fromDivisionId: string | null;
  toDivisionId: string;
  toSectionId: string | null;
  routedById: string;
  remarks: string | null;
  /*
   * The hop's own receipt. `acceptedAt === null` is what makes the document pending at this hop,
   * and the pair is what the routing slip prints as DATE-TIME RECEIVED — so it is read straight
   * off the route rather than inferred from the timeline (ADR-0005).
   */
  forInformation: boolean;
  acceptedAt: Date | null;
  acceptedById: string | null;
  createdAt: Date;
}

export interface SignatureEntry {
  id: string;
  fileVersionId: string;
  signerId: string;
  signedAt: Date;
}

export interface DocumentDetail extends PublicDocument {
  assigneeUserIds: string[];
  sharedUserIds: string[];
  routes: RouteEntry[];
  signatures: SignatureEntry[];
  timeline: TimelineEntry[];
  allowedActions: WorkflowAction[];
}

/**
 * How many recent actions the dashboard feed carries.
 *
 * Small on purpose: this is a glance at what is moving, not a log. Anyone who wants the full
 * history has the document's own timeline, and anyone auditing has `/admin/audit-events`.
 */
export const DASHBOARD_ACTIVITY_LIMIT = 10;

export interface DashboardSummary extends DashboardCounts {
  pendingByDivision: DashboardDivisionPending[];
  recentActivity: DashboardActivityEntry[];
}

export interface DocumentSearchResult {
  items: PublicDocument[];
  total: number;
  page: number;
  pageSize: number;
}

// The metadata fields whose before/after are recorded on every edit. Kept in one place so the
// revision snapshot and the applied patch can never drift apart.
const METADATA_FIELDS = [
  'title',
  'type',
  'description',
  'priority',
  'sender',
  'company',
  'referenceNumber',
  'email',
  'confidential',
  'dueAt',
] as const;

@Injectable()
export class DocumentsService {
  private readonly authorization = new AuthorizationPolicy();
  private readonly workflow = new WorkflowService();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly repository: DocumentsRepository,
    private readonly users: UsersRepository,
    private readonly fileVersions: FileVersionsRepository,
    private readonly notifications: NotificationsRepository,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  // The row's file-version columns are aliased to the API's "attachment" vocabulary here.
  // `hasCleanCurrentAttachment` and `releaseMethod` are passed in only where they have been
  // loaded (single-document responses); list items leave them at their defaults to avoid an
  // N+1 scan/release lookup per row.
  private toPublic(
    row: DocumentRow,
    releaseMethod: ReleaseMethod | null = null,
    hasCleanCurrentAttachment = false,
  ): PublicDocument {
    return {
      id: row.id,
      trackingNumber: row.trackingNumber,
      referenceNumber: row.referenceNumber,
      title: row.title,
      type: row.type,
      description: row.description,
      priority: row.priority,
      direction: row.direction,
      status: row.status,
      sender: row.sender,
      company: row.company,
      email: row.email,
      divisionId: row.divisionId,
      sectionId: row.sectionId,
      createdById: row.createdById,
      confidential: row.confidential,
      dueAt: row.dueAt,
      version: row.version,
      currentAttachmentVersionId: row.currentFileVersionId,
      signedAttachmentVersionId: row.signedFileVersionId,
      hasCleanCurrentAttachment,
      releaseMethod,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Whether a document's current attachment version has passed scanning. */
  private async cleanFlag(row: DocumentRow): Promise<boolean> {
    return row.currentFileVersionId !== null
      ? this.fileVersions.isClean(row.currentFileVersionId)
      : false;
  }

  /**
   * Whether a document's current attachment could carry a release: clean **and** fixed-form.
   *
   * Distinct from {@link cleanFlag}, which is what the API reports as
   * `hasCleanCurrentAttachment` and means exactly what it says. This one feeds the workflow's
   * release rule, where a clean but editable `.docx` is not sufficient (D-83, D-71).
   */
  private async releasableFlag(row: DocumentRow): Promise<boolean> {
    return row.currentFileVersionId !== null
      ? this.fileVersions.isReleasable(row.currentFileVersionId)
      : false;
  }

  // ------------------------------------------------------------------- create

  async create(actor: RequestUser, input: CreateDocumentInput): Promise<PublicDocument> {
    if (!actor.capabilities.includes('DOCUMENT_CREATE'))
      throw new ForbiddenException('Document creation is not allowed');

    const placement = await this.repository.resolvePlacement(
      input.divisionId,
      input.sectionId ?? null,
    );
    if (!placement.ok) throw new BadRequestException(placement.reason);
    const year = new Date().getUTCFullYear();

    const row = await this.database.transaction(async (tx) => {
      const trackingValue = await this.repository.allocateTracking(tx);
      const trackingNumber = `DTS-${year}-${String(trackingValue).padStart(6, '0')}`;

      // Incoming mail keeps whatever external reference the sender used; outgoing
      // correspondence is stamped with an office reference allocated per division and year.
      let referenceNumber = input.referenceNumber ?? null;
      if (input.direction === 'OUTGOING') {
        const value = await this.repository.allocateReference(input.divisionId, year, tx);
        referenceNumber = `${placement.divisionCode}-${year}-${String(value).padStart(5, '0')}`;
      }

      const created = await this.repository.insert(
        {
          trackingNumber,
          referenceNumber,
          title: input.title,
          type: input.type,
          description: input.description ?? null,
          priority: input.priority,
          direction: input.direction,
          status: 'IN_PROCESS',
          sender: input.sender ?? null,
          company: input.company ?? null,
          email: input.email ?? null,
          divisionId: input.divisionId,
          sectionId: input.sectionId ?? null,
          createdById: actor.id,
          confidential: input.confidential,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
        },
        tx,
      );
      /*
       * Registration is not acceptance, and creating a document confers no custody
       * (decision 154). The unaccepted route row is what records that: it is handed to the
       * division it was registered for, and the document reads as pending — to that unit, on the
       * dashboard and in the registry — until someone there takes it on. Writing it here rather
       * than leaving the document route-less is what makes the derived condition true from the
       * first second, instead of a document appearing already in hand.
       */
      await this.repository.insertRoute(
        {
          documentId: created.id,
          fromDivisionId: null,
          toDivisionId: created.divisionId,
          toSectionId: created.sectionId,
          routedById: actor.id,
          remarks: null,
        },
        tx,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.created',
          targetType: 'document',
          targetId: created.id,
          outcome: 'SUCCESS',
          summary: { trackingNumber, direction: created.direction, divisionId: created.divisionId },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: created.id,
          eventType: 'document.created',
          payload: { documentId: created.id, trackingNumber },
          idempotencyKey: `document.created:${created.id}`,
        },
        tx,
      );
      return created;
    });

    return this.toPublic(row);
  }

  // --------------------------------------------------------------- read / list

  async search(actor: RequestUser, filters: DocumentSearchFilters): Promise<DocumentSearchResult> {
    const page = await this.repository.search(actor, filters);
    return {
      items: page.items.map((row) => this.toPublic(row)),
      total: page.total,
      page: page.page,
      pageSize: page.pageSize,
    };
  }

  async getDocument(actor: RequestUser, id: string): Promise<DocumentDetail> {
    const row = await this.requireReadable(actor, id);
    const [
      timeline,
      assigneeUserIds,
      sharedUserIds,
      releaseMethod,
      routes,
      signatures,
      clean,
      ord,
    ] = await Promise.all([
      this.repository.listTimeline(id),
      this.repository.listActiveAssigneeIds(id),
      this.repository.listSharedUserIds(id),
      this.repository.findReleaseMethod(id),
      this.repository.listRoutes(id),
      this.repository.listSignatures(id),
      this.cleanFlag(row),
      this.repository.isOrdDivision(row.divisionId),
    ]);
    return {
      ...this.toPublic(row, releaseMethod, clean),
      assigneeUserIds,
      sharedUserIds,
      signatures: signatures.map((signature) => ({
        id: signature.id,
        fileVersionId: signature.fileVersionId,
        signerId: signature.signerId,
        signedAt: signature.signedAt,
      })),
      routes: routes.map((route) => ({
        id: route.id,
        fromDivisionId: route.fromDivisionId,
        toDivisionId: route.toDivisionId,
        toSectionId: route.toSectionId,
        routedById: route.routedById,
        remarks: route.remarks,
        forInformation: route.forInformation,
        acceptedAt: route.acceptedAt,
        acceptedById: route.acceptedById,
        createdAt: route.createdAt,
      })),
      timeline: timeline.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        actorId: event.actorId,
        action: event.action,
        // The vocabulary in force when the event was written; see `TimelineEntry`.
        fromStatus: event.fromStatus as WorkflowStatus | null,
        toStatus: event.toStatus as WorkflowStatus,
        remarks: event.remarks,
        occurredAt: event.occurredAt,
      })),
      allowedActions: this.workflowActionsFor(
        actor,
        row,
        {
          ...this.workflowShape(row, clean, ord),
          routes: routes.map((route) => this.toRouteCustody(route)),
        },
        // Already loaded for the payload above, so the capability filter costs no extra query.
        { routes, assigneeUserIds, sharedUserIds },
      ),
    };
  }

  async metadataHistory(actor: RequestUser, id: string): Promise<MetadataRevisionEntry[]> {
    await this.requireReadable(actor, id);
    const revisions = await this.repository.listMetadataRevisions(id);
    return revisions.map((revision) => ({
      id: revision.id,
      actorId: revision.actorId,
      before: revision.before as Record<string, unknown>,
      after: revision.after as Record<string, unknown>,
      occurredAt: revision.occurredAt,
    }));
  }

  async allowedActions(actor: RequestUser, id: string): Promise<WorkflowAction[]> {
    const row = await this.repository.findReadableById(actor, id);
    if (row === null) return [];
    const [document, facts] = await Promise.all([this.toWorkflowDocument(row), this.factsFor(id)]);
    return this.workflowActionsFor(actor, row, document, facts);
  }

  // -------------------------------------------------------------- metadata edit

  async editMetadata(
    actor: RequestUser,
    id: string,
    input: UpdateDocumentMetadataInput,
  ): Promise<PublicDocument> {
    const { row: current, facts } = await this.requireReadableWithFacts(actor, id);
    if (!this.authorization.can(actor, this.asResource(current, facts), 'DOCUMENT_EDIT'))
      throw new ForbiddenException('Editing this document is not allowed');

    const { patch, before, after } = this.diffMetadata(current, input);
    if (Object.keys(after).length === 0)
      throw new BadRequestException({
        code: 'NO_METADATA_CHANGE',
        message: 'The supplied metadata matches the current values',
      });

    const updated = await this.database.transaction(async (tx) => {
      const row = await this.repository.updateMetadata(id, input.expectedVersion, patch, tx);
      if (row === null) throw this.staleConflict();
      await this.repository.insertMetadataRevision(
        { documentId: id, actorId: actor.id, before, after },
        tx,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.metadata-edited',
          targetType: 'document',
          targetId: id,
          outcome: 'SUCCESS',
          summary: { fields: Object.keys(after) },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.metadata-edited',
          payload: { documentId: id, fields: Object.keys(after) },
          idempotencyKey: `document.metadata-edited:${id}:${row.version}`,
        },
        tx,
      );
      return row;
    });
    return this.toPublic(updated, null, await this.cleanFlag(updated));
  }

  // ----------------------------------------------------------- logical deletion

  /**
   * Soft-deletes a document: it disappears from every list/search/detail (all of which exclude
   * `deleted_at`) but its rows and history are preserved for restore. Capability-gated and under
   * optimistic concurrency, so a stale delete is a 409 rather than a silent clobber.
   */
  async softDelete(
    actor: RequestUser,
    id: string,
    expectedVersion: number,
  ): Promise<PublicDocument> {
    const { row: current, facts } = await this.requireReadableWithFacts(actor, id);
    if (!this.authorization.can(actor, this.asResource(current, facts), 'DOCUMENT_DELETE'))
      throw new ForbiddenException('Deleting this document is not allowed');

    const deleted = await this.database.transaction(async (tx) => {
      const row = await this.repository.softDelete(id, expectedVersion, tx);
      if (row === null) throw this.staleConflict();
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.deleted',
          targetType: 'document',
          targetId: id,
          outcome: 'SUCCESS',
          summary: { trackingNumber: current.trackingNumber },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.deleted',
          payload: { documentId: id },
          idempotencyKey: `document.deleted:${id}:${row.version}`,
        },
        tx,
      );
      return row;
    });
    return this.toPublic(deleted);
  }

  /**
   * Restores a soft-deleted document. It loads the row *including* deleted ones (the normal read
   * path cannot see it), then enforces the restore capability and scope on the loaded row.
   */
  async restore(actor: RequestUser, id: string, expectedVersion: number): Promise<PublicDocument> {
    const current = await this.repository.findByIdIncludingDeleted(id);
    if (current === null) throw new NotFoundException('Document not found');
    if (
      !this.authorization.can(
        actor,
        this.asResource(current, await this.factsFor(id)),
        'DOCUMENT_RESTORE',
      )
    )
      throw new ForbiddenException('Restoring this document is not allowed');
    if (current.deletedAt === null)
      throw new ConflictException({
        code: 'DOCUMENT_NOT_DELETED',
        message: 'The document is not deleted',
      });

    const restored = await this.database.transaction(async (tx) => {
      const row = await this.repository.restore(id, expectedVersion, tx);
      if (row === null) throw this.staleConflict();
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.restored',
          targetType: 'document',
          targetId: id,
          outcome: 'SUCCESS',
          summary: { trackingNumber: current.trackingNumber },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.restored',
          payload: { documentId: id },
          idempotencyKey: `document.restored:${id}:${row.version}`,
        },
        tx,
      );
      return row;
    });
    return this.toPublic(restored);
  }

  // --------------------------------------------------------------- workflow

  async executeAction(
    actor: RequestUser,
    id: string,
    action: WorkflowAction,
    input: { expectedVersion: number; remarks?: string; releaseMethod?: ReleaseMethod },
  ): Promise<PublicDocument> {
    const { row: current, facts } = await this.requireReadableWithFacts(actor, id);
    const capability = WORKFLOW_ACTION_CAPABILITIES[action];
    if (!this.authorization.can(actor, this.asResource(current, facts), capability))
      throw new ForbiddenException('Action is not allowed');

    // Signing pins the version being signed; releasing checks that pin against the current
    // attachment. Scan state and media type are both read from the persisted file version: the
    // workflow's release rule needs an attachment that is clean AND fixed-form, so an editable
    // Office document cannot evidence a release (D-83).
    const currentClean = await this.releasableFlag(current);

    try {
      const result = this.workflow.execute(
        await this.toWorkflowDocument(current),
        this.toWorkflowActor(actor),
        { action, actorId: actor.id, ...input },
      );

      /*
       * Acceptance is custody, not lifecycle. It stamps a route row and stops — the document's
       * status and version are untouched, because nothing about the document changed: a hop that
       * was outstanding is now taken on (ADR-0005). It is also the one action with a second writer
       * racing it, so the conditional update is the real guard and this is where it happens.
       */
      if (result.acceptedRouteId !== null) {
        return await this.database.transaction(async (tx) => {
          const accepted = await this.repository.acceptRoute(result.acceptedRouteId!, actor.id, tx);
          if (accepted === null)
            throw new UnprocessableEntityException({
              code: 'ROUTE_ALREADY_ACCEPTED',
              message: 'This hop has already been accepted',
            });
          /*
           * Accepting still belongs on the timeline. The status does not move, so the event's
           * from and to are the same — but "received by the pilot division at 09:14" is exactly
           * what the slip prints and what the timeline exists to show (decisions 30, 63).
           */
          const sequence = await this.repository.nextWorkflowSequence(id, tx);
          await this.repository.insertWorkflowEvent(
            {
              documentId: id,
              sequence,
              actorId: actor.id,
              action,
              fromStatus: current.status,
              toStatus: current.status,
              remarks: result.event.remarks,
            },
            tx,
          );
          await this.audit.write(
            {
              actorId: actor.id,
              action: 'document.custody-accepted',
              targetType: 'document',
              targetId: id,
              outcome: 'SUCCESS',
              summary: { routeId: accepted.id, toDivisionId: accepted.toDivisionId },
            },
            tx,
          );
          await this.outbox.enqueue(
            {
              aggregateType: 'document',
              aggregateId: id,
              eventType: 'document.custody-accepted',
              payload: { documentId: id, routeId: accepted.id },
              idempotencyKey: `document.custody-accepted:${accepted.id}`,
            },
            tx,
          );
          return this.toPublic(current, null, currentClean);
        });
      }

      const patch = {
        status: result.document.status,
        ...(action === 'SIGN' ? { signedFileVersionId: current.currentFileVersionId } : {}),
      };

      return await this.database.transaction(async (tx) => {
        const updated = await this.repository.updateForAction(id, input.expectedVersion, patch, tx);
        if (updated === null) throw this.staleConflict();
        const sequence = await this.repository.nextWorkflowSequence(id, tx);
        await this.repository.insertWorkflowEvent(
          {
            documentId: id,
            sequence,
            actorId: actor.id,
            action,
            fromStatus: current.status,
            toStatus: updated.status,
            remarks: result.event.remarks,
          },
          tx,
        );
        // A release records how the document physically left the office; the unique
        // documentId on release_events makes a second release a hard conflict at the DB.
        if (action === 'RELEASE' && result.event.releaseMethod !== null)
          await this.repository.insertReleaseEvent(
            { documentId: id, releasedById: actor.id, method: result.event.releaseMethod },
            tx,
          );
        // Signing is recorded as an evidentiary event against the version that was signed (now
        // that `file_versions` is persisted). With no current attachment there is nothing to
        // reference, so only the status moves and `signedFileVersionId` stays null.
        if (action === 'SIGN' && current.currentFileVersionId !== null)
          await this.repository.insertSignatureEvent(
            { documentId: id, fileVersionId: current.currentFileVersionId, signerId: actor.id },
            tx,
          );
        await this.audit.write(
          {
            actorId: actor.id,
            action: `document.workflow.${action.toLowerCase()}`,
            targetType: 'document',
            targetId: id,
            outcome: 'SUCCESS',
            summary: { from: current.status, to: updated.status },
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            aggregateType: 'document',
            aggregateId: id,
            eventType: `document.${action.toLowerCase()}`,
            payload: { documentId: id, from: current.status, to: updated.status },
            idempotencyKey: `document.workflow:${id}:${sequence}`,
          },
          tx,
        );
        return this.toPublic(updated, result.event.releaseMethod, currentClean);
      });
    } catch (error) {
      // Best-effort failure trail; a workflow rejection is expected traffic, not a fault.
      await this.audit
        .write({
          actorId: actor.id,
          action: `document.workflow.${action.toLowerCase()}`,
          targetType: 'document',
          targetId: id,
          outcome: 'FAILURE',
          summary: { status: current.status },
        })
        .catch(() => undefined);
      if (error instanceof WorkflowConflictError)
        throw new ConflictException({ code: 'WORKFLOW_CONFLICT', message: error.message });
      if (error instanceof IllegalTransitionError)
        throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: error.message });
      if (error instanceof WorkflowRuleError)
        throw new UnprocessableEntityException({ code: error.code, message: error.message });
      throw error;
    }
  }

  // --------------------------------------------------------------- assignment

  async assign(
    actor: RequestUser,
    documentId: string,
    recipientUserId: string,
  ): Promise<DocumentDetail> {
    const { row: current, facts } = await this.requireReadableWithFacts(actor, documentId);
    if (!this.authorization.can(actor, this.asResource(current, facts), 'DOCUMENT_ASSIGN'))
      throw new ForbiddenException('Assignment is not allowed');
    const recipient = await this.users.findById(recipientUserId);
    if (recipient === null || !recipient.active)
      throw new NotFoundException('The assignee could not be found');

    await this.database.transaction(async (tx) => {
      if (await this.repository.hasActiveAssignment(documentId, recipientUserId, tx)) return;
      await this.repository.insertAssignment(
        { documentId, userId: recipientUserId, assignedById: actor.id },
        tx,
      );
      // The durable inbox row is written in the same transaction as the assignment, so a
      // notification can never go missing because the delivery worker was down. The outbox row
      // beside it is what the relay fans out for realtime/email delivery.
      await this.notifications.insert(
        {
          recipientUserId,
          type: 'DOCUMENT_ASSIGNED',
          title: 'Document assigned',
          body: `${current.trackingNumber}: ${current.title}`,
          documentId,
          idempotencyKey: `notify:document.assigned:${documentId}:${recipientUserId}`,
        },
        tx,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.assigned',
          targetType: 'document',
          targetId: documentId,
          outcome: 'SUCCESS',
          summary: { recipientUserId },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: documentId,
          eventType: 'document.assigned',
          payload: { documentId, recipientUserId },
          idempotencyKey: `document.assigned:${documentId}:${recipientUserId}`,
        },
        tx,
      );
    });

    return this.getDocument(actor, documentId);
  }

  // ------------------------------------------------------------ routing / sharing

  /**
   * Forwards a document to another division (optionally a section within it): records the hop in
   * `document_routes` under the optimistic-version guard, and with it one row per division copied
   * in for information.
   *
   * It does **not** move `documents.division_id` any more (ADR-0005). The document's location is
   * the hop it is sitting at, which is why the no-op check and `from_division_id` below are both
   * resolved from the route history rather than from the row: the column records where the document
   * was registered, and after the first forward that is not where it is.
   */
  async route(actor: RequestUser, id: string, input: RouteDocumentInput): Promise<DocumentDetail> {
    const { row: current, facts } = await this.requireReadableWithFacts(actor, id);
    if (!this.authorization.can(actor, this.asResource(current, facts), 'DOCUMENT_ASSIGN'))
      throw new ForbiddenException('Routing this document is not allowed');

    const toSectionId = input.toSectionId ?? null;
    const custody = await this.currentCustody(current);
    if (custody.divisionId === input.toDivisionId && custody.sectionId === toSectionId)
      throw new BadRequestException({
        code: 'ROUTE_NO_OP',
        message: 'The document is already at that division and section',
      });
    const placement = await this.repository.resolvePlacement(input.toDivisionId, toSectionId);
    if (!placement.ok) throw new BadRequestException(placement.reason);

    // Division-level only, by decision 160 — resolved with a null section for exactly that reason.
    const forInformationDivisionIds = input.forInformationDivisionIds ?? [];
    for (const divisionId of forInformationDivisionIds) {
      const copy = await this.repository.resolvePlacement(divisionId, null);
      if (!copy.ok) throw new BadRequestException(copy.reason);
    }
    const informationRecipients = await this.divisionHeadsOf(forInformationDivisionIds);
    const remarks = input.remarks?.trim() ? input.remarks.trim() : null;

    await this.database.transaction(async (tx) => {
      /*
       * Nothing on the document row changes, so the bump exists only as the concurrency control:
       * two people forwarding the same document at once must not both succeed, and
       * `expectedVersion` is the client's one guard against it. `ACCEPT` deliberately does not
       * bump — it stamps a route row and the document itself is untouched — but a forward changes
       * custody, and the next forward has to be made to see it.
       */
      const moved = await this.repository.bumpVersion(id, input.expectedVersion, tx);
      if (moved === null) throw this.staleConflict();
      await this.repository.insertRoute(
        {
          documentId: id,
          fromDivisionId: custody.divisionId,
          toDivisionId: input.toDivisionId,
          toSectionId,
          routedById: actor.id,
          remarks,
        },
        tx,
      );
      for (const divisionId of forInformationDivisionIds) {
        await this.repository.insertRoute(
          {
            documentId: id,
            fromDivisionId: custody.divisionId,
            toDivisionId: divisionId,
            toSectionId: null,
            routedById: actor.id,
            remarks,
            forInformation: true,
          },
          tx,
        );
      }
      /*
       * The heads of the copied divisions are notified because they are precisely the people the
       * copy just made readers: a division-level hop is reachable by the division head, not by
       * every section inside it (`routesReachUnit`). The lead recipient gets no notification here
       * and never has — forwarding for action surfaces through the work queue — so this is
       * deliberately asymmetrical, and that is the thing to revisit if a lead notification is
       * ever added rather than quietly notifying both from here.
       */
      for (const recipient of informationRecipients) {
        await this.notifications.insert(
          {
            recipientUserId: recipient.id,
            type: 'DOCUMENT_ROUTED',
            title: 'Copied in for information',
            body: `${current.trackingNumber}: ${current.title}`,
            documentId: id,
            idempotencyKey: `notify:document.routed:${id}:${moved.version}:${recipient.id}`,
          },
          tx,
        );
      }
      // One event for one act: a forward that consults three divisions is still one forward, and
      // the recipient list is what the audit trail needs to reconstruct it.
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.routed',
          targetType: 'document',
          targetId: id,
          outcome: 'SUCCESS',
          summary: {
            fromDivisionId: custody.divisionId,
            toDivisionId: input.toDivisionId,
            toSectionId,
            forInformationDivisionIds,
          },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.routed',
          payload: {
            documentId: id,
            toDivisionId: input.toDivisionId,
            toSectionId,
            forInformationDivisionIds,
          },
          idempotencyKey: `document.routed:${id}:${moved.version}`,
        },
        tx,
      );
    });
    return this.getDocument(actor, id);
  }

  /** Grants one user read access to a document without moving or reassigning it. */
  async share(actor: RequestUser, id: string, userId: string): Promise<DocumentDetail> {
    const { row: current, facts } = await this.requireReadableWithFacts(actor, id);
    if (!this.authorization.can(actor, this.asResource(current, facts), 'DOCUMENT_ASSIGN'))
      throw new ForbiddenException('Sharing this document is not allowed');
    const recipient = await this.users.findById(userId);
    if (recipient === null || !recipient.active)
      throw new NotFoundException('The recipient could not be found');

    await this.database.transaction(async (tx) => {
      await this.repository.insertShare({ documentId: id, userId, sharedById: actor.id }, tx);
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.shared',
          targetType: 'document',
          targetId: id,
          outcome: 'SUCCESS',
          summary: { userId },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.shared',
          payload: { documentId: id, userId },
          idempotencyKey: `document.shared:${id}:${userId}`,
        },
        tx,
      );
    });
    return this.getDocument(actor, id);
  }

  /** The actor's work queue: live documents they currently hold an active assignment on. */
  async assignedQueue(actor: RequestUser): Promise<PublicDocument[]> {
    const rows = await this.repository.listAssignedTo(actor.id);
    return rows.map((row) => this.toPublic(row));
  }

  /**
   * The deleted documents this actor could restore.
   *
   * Filtered by the restore capability on each loaded row rather than by a blanket check on the
   * actor: `DOCUMENT_RESTORE` is scoped, so the right answer is per-document, and it is the same
   * predicate `restore()` itself applies — a row listed here cannot then be refused on restore,
   * and a row that would be refused is never offered.
   */
  async deletedQueue(actor: RequestUser): Promise<PublicDocument[]> {
    const rows = await this.repository.listDeleted(actor);
    const facts = await this.repository.authorizationFacts(rows.map((row) => row.id));
    return rows
      .filter((row) =>
        this.authorization.can(
          actor,
          this.asResource(row, facts.get(row.id) ?? this.noFacts()),
          'DOCUMENT_RESTORE',
        ),
      )
      .map((row) => this.toPublic(row));
  }

  /**
   * Everything the dashboard shows, in one round trip.
   *
   * All three parts resolve against the same `documentScopeFor` predicate the registry list uses,
   * which is the point: a division chart that counted rows the list would not show, or an activity
   * feed naming a document the user cannot open, would be a disclosure dressed as a summary — and
   * a user who clicked through would land on a 403.
   */
  async dashboardSummary(actor: RequestUser): Promise<DashboardSummary> {
    const [counts, pendingByDivision, recentActivity] = await Promise.all([
      this.repository.summary(actor),
      this.repository.pendingByDivision(actor),
      this.repository.recentActivity(actor, DASHBOARD_ACTIVITY_LIMIT),
    ]);
    return { ...counts, pendingByDivision, recentActivity };
  }

  // --------------------------------------------------------------- reports

  async monthlyReport(actor: RequestUser, year: number, month: number): Promise<MonthlyReport> {
    if (!actor.capabilities.includes('REPORT_VIEW'))
      throw new ForbiddenException('Report access is not allowed');
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12)
      throw new BadRequestException('A valid report month and year are required');

    // Scope and confidentiality are already applied in SQL (`documentScopeFor`), so the rows
    // are exactly what this actor may see; the assignment/share arrays are only needed for the
    // read policy that has already run, hence left empty on the report projection.
    const rows = await this.repository.listForReport(actor, year, month);
    const documents = rows.map((row) => ({
      id: row.id,
      title: row.title,
      referenceNumber: row.referenceNumber,
      sender: row.sender,
      company: row.company,
      type: row.type,
      direction: row.direction,
      createdAt: row.createdAt,
      divisionId: row.divisionId,
      sectionId: row.sectionId,
      confidential: row.confidential,
    }));
    await this.audit.write({
      actorId: actor.id,
      action: 'report.monthly-viewed',
      targetType: 'report',
      targetId: `${year}-${month}`,
      outcome: 'SUCCESS',
      summary: { year, month },
    });
    return {
      year,
      month,
      totals: {
        incoming: documents.filter((doc) => doc.direction === 'INCOMING').length,
        outgoing: documents.filter((doc) => doc.direction === 'OUTGOING').length,
        foiRequests: documents.filter((doc) => doc.type === 'FOI_REQUEST').length,
        specialOrders: documents.filter((doc) => doc.type === 'SPECIAL_ORDER').length,
        total: documents.length,
      },
      documents,
    };
  }

  // --------------------------------------------- helpers used by the files module

  /**
   * Loads a document an actor may attach files to, enforcing the same edit capability the
   * metadata path uses and refusing edits to a frozen (released/archived) record. Returns the
   * row so the caller can compare version ids for the "is current / is signed" flags.
   */
  async requireEditableDocument(actor: RequestUser, documentId: string): Promise<DocumentRow> {
    const { row: document, facts } = await this.requireReadableWithFacts(actor, documentId);
    if (!this.authorization.can(actor, this.asResource(document, facts), 'DOCUMENT_EDIT'))
      throw new ForbiddenException('Editing this document is not allowed');
    if (document.status === 'RELEASED' || document.status === 'ARCHIVED')
      throw new ConflictException({
        code: 'DOCUMENT_NOT_EDITABLE',
        message: 'Attachments cannot be added to a released or archived document',
      });
    return document;
  }

  /** Loads a document an actor may read, for the attachment list/download/scan paths. */
  async requireReadableDocument(actor: RequestUser, documentId: string): Promise<DocumentRow> {
    return this.requireReadable(actor, documentId);
  }

  /** Points the document at a freshly uploaded attachment version and bumps its row version. */
  async setCurrentAttachment(documentId: string, versionId: string): Promise<DocumentRow> {
    const updated = await this.repository.setCurrentFileVersion(documentId, versionId);
    if (updated === null) throw new NotFoundException('Document not found');
    return updated;
  }

  // ------------------------------------------------------------------- internals

  private async requireReadable(actor: RequestUser, id: string): Promise<DocumentRow> {
    const row = await this.repository.findReadableById(actor, id);
    if (row === null) throw new NotFoundException('Document not found');
    return row;
  }

  /**
   * The actions this actor may take on a document, filtered a second time by the authorization
   * policy.
   *
   * The prepared {@link WorkflowDocument} is a required argument rather than something assembled
   * here: it carries the custody facts, and a stubbed-out `routes: []` would silently report that
   * nothing is outstanding — offering onward actions on a document nobody has accepted, which is
   * the exact failure the revision exists to prevent.
   */
  private workflowActionsFor(
    actor: RequestUser,
    row: DocumentRow,
    document: WorkflowDocument,
    facts: DocumentAuthorizationFacts,
  ): WorkflowAction[] {
    if (actor.role === 'VIEWER') return [];
    return this.workflow
      .allowedActions(document, this.toWorkflowActor(actor))
      .filter((action) =>
        this.authorization.can(
          actor,
          this.asResource(row, facts),
          WORKFLOW_ACTION_CAPABILITIES[action],
        ),
      );
  }

  /** Everything the engine needs from a document row except its custody hops. */
  private workflowShape(
    row: DocumentRow,
    clean: boolean,
    ownerDivisionIsOrd: boolean,
  ): Omit<WorkflowDocument, 'routes'> {
    return {
      id: row.id,
      status: row.status,
      version: row.version,
      direction: row.direction,
      ownerDivisionIsOrd,
      hasCleanCurrentAttachment: clean,
      currentAttachmentVersionId: row.currentFileVersionId,
      signedAttachmentVersionId: row.signedFileVersionId,
    };
  }

  private toRouteCustody(route: DocumentRouteRow): RouteCustody {
    return {
      id: route.id,
      toDivisionId: route.toDivisionId,
      toSectionId: route.toSectionId,
      forInformation: route.forInformation,
      acceptedAt: route.acceptedAt,
    };
  }

  /**
   * The actor as the workflow engine sees them.
   *
   * Placement is carried alongside capabilities because accepting custody is inherently positional:
   * a route is handed to a division (or a section within it), and only the unit it names can take
   * it on. Capabilities alone answer "may this person accept things at all", which is a different
   * question from "is this one theirs".
   */
  private toWorkflowActor(actor: RequestUser): WorkflowActor {
    return {
      id: actor.id,
      divisionId: actor.divisionId,
      sectionId: actor.sectionId,
      capabilities: actor.capabilities,
    };
  }

  /**
   * The document as the workflow engine sees it — its two orthogonal axes plus the guards the
   * release and ORD rules need. Resolved here rather than inside the engine so that service stays
   * a pure function of its inputs and stays testable without a database.
   */
  private async toWorkflowDocument(row: DocumentRow): Promise<WorkflowDocument> {
    const [clean, routes, ord] = await Promise.all([
      this.releasableFlag(row),
      this.repository.listRoutes(row.id),
      this.repository.isOrdDivision(row.divisionId),
    ]);
    return {
      ...this.workflowShape(row, clean, ord),
      routes: routes.map((route) => this.toRouteCustody(route)),
    };
  }

  /**
   * The row as the in-memory policy sees it.
   *
   * The facts are a required argument, and they used to be stubbed out as empty arrays on the
   * reasoning that a row already proven readable in SQL needed only its own columns. ADR-0005 ended
   * that: `documents.division_id` is now the *registering* placement and never moves, so a document
   * forwarded to another unit matches nothing on the row itself — the receiving division's claim to
   * it lives only on a route row. Pass the facts and both halves agree; stub them and every
   * capability check on a forwarded document is a false 403.
   */
  private asResource(row: DocumentRow, facts: DocumentAuthorizationFacts): AuthorizationResource {
    return {
      id: row.id,
      divisionId: row.divisionId,
      sectionId: row.sectionId,
      routes: facts.routes,
      assigneeUserIds: facts.assigneeUserIds,
      sharedUserIds: facts.sharedUserIds,
      confidential: row.confidential,
    };
  }

  /**
   * Where the document is now: the most recent hop that took custody, falling back to the
   * registering placement.
   *
   * The fallback is not defensive padding — documents registered before migration `0005` have no
   * route rows at all, and for those the column is still the only answer there is.
   */
  private async currentCustody(
    row: DocumentRow,
  ): Promise<{ divisionId: string; sectionId: string | null }> {
    const lead = leadCustodyRoute(
      (await this.repository.listRoutes(row.id)).map((route) => this.toRouteCustody(route)),
    );
    if (lead === undefined) return { divisionId: row.divisionId, sectionId: row.sectionId };
    return { divisionId: lead.toDivisionId, sectionId: lead.toSectionId };
  }

  /**
   * The active heads of the named divisions, deduplicated — the readers a copy for information
   * creates, and so the people it notifies.
   */
  private async divisionHeadsOf(divisionIds: readonly string[]): Promise<{ id: string }[]> {
    if (divisionIds.length === 0) return [];
    const heads = await Promise.all(
      divisionIds.map((divisionId) =>
        this.users.list({ role: 'DIVISION_HEAD', divisionId, active: true }),
      ),
    );
    return [...new Map(heads.flat().map((head) => [head.id, { id: head.id }])).values()];
  }

  /** The empty facts: no hops, no assignment, no share. Reachable only for a row with no rows. */
  private noFacts(): DocumentAuthorizationFacts {
    return { routes: [], assigneeUserIds: [], sharedUserIds: [] };
  }

  /** {@link DocumentsRepository.authorizationFacts} for one document. */
  private async factsFor(documentId: string): Promise<DocumentAuthorizationFacts> {
    const facts = await this.repository.authorizationFacts([documentId]);
    return facts.get(documentId) ?? this.noFacts();
  }

  /**
   * Loads a readable document together with the facts every capability check now needs.
   *
   * The capability call sites take this rather than {@link requireReadable} because forgetting the
   * facts is not a visible mistake — it reads as a plausible 403 on exactly the documents routing
   * was built to move.
   */
  private async requireReadableWithFacts(
    actor: RequestUser,
    id: string,
  ): Promise<{ row: DocumentRow; facts: DocumentAuthorizationFacts }> {
    const row = await this.requireReadable(actor, id);
    return { row, facts: await this.factsFor(id) };
  }

  private diffMetadata(current: DocumentRow, input: UpdateDocumentMetadataInput) {
    const patch: DocumentMetadataPatch = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const field of METADATA_FIELDS) {
      const incoming = input[field];
      if (incoming === undefined) continue;
      const next =
        field === 'dueAt' && typeof incoming === 'string' ? new Date(incoming) : incoming;
      const existing = current[field];
      const existingComparable = existing instanceof Date ? existing.getTime() : existing;
      const nextComparable = next instanceof Date ? next.getTime() : next;
      if (existingComparable === nextComparable) continue;
      (patch as Record<string, unknown>)[field] = next;
      before[field] = existing instanceof Date ? existing.toISOString() : existing;
      after[field] = next instanceof Date ? next.toISOString() : next;
    }
    return { patch, before, after };
  }

  private staleConflict(): ConflictException {
    return new ConflictException({
      code: 'DOCUMENT_CONFLICT',
      message: 'The document was changed by someone else; reload and try again',
    });
  }
}
