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
import { AuthorizationPolicy } from '../authorization/authorization.policy.js';
import { NotificationsRepository } from '../notifications/notifications.repository.js';
import type { MonthlyReport } from '../reports/monthly-report.js';
import { UsersRepository } from '../users/users.repository.js';
import { FileVersionsRepository } from '../files/file-versions.repository.js';
import {
  IllegalTransitionError,
  WORKFLOW_ACTION_CAPABILITIES,
  WorkflowConflictError,
  WorkflowRuleError,
  WorkflowService,
  type ReleaseMethod,
  type WorkflowAction,
} from '../workflow/workflow.service.js';
import {
  DocumentsRepository,
  type DashboardActivityEntry,
  type DashboardCounts,
  type DashboardDivisionPending,
  type DocumentMetadataPatch,
  type DocumentRow,
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
  fromStatus: DocumentRow['status'] | null;
  toStatus: DocumentRow['status'];
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
          status: 'PENDING',
          sender: input.sender ?? null,
          company: input.company ?? null,
          divisionId: input.divisionId,
          sectionId: input.sectionId ?? null,
          createdById: actor.id,
          confidential: input.confidential,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
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
    const [timeline, assigneeUserIds, sharedUserIds, releaseMethod, routes, signatures, clean] =
      await Promise.all([
        this.repository.listTimeline(id),
        this.repository.listActiveAssigneeIds(id),
        this.repository.listSharedUserIds(id),
        this.repository.findReleaseMethod(id),
        this.repository.listRoutes(id),
        this.repository.listSignatures(id),
        this.cleanFlag(row),
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
        createdAt: route.createdAt,
      })),
      timeline: timeline.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        actorId: event.actorId,
        action: event.action,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        remarks: event.remarks,
        occurredAt: event.occurredAt,
      })),
      allowedActions: this.workflowActionsFor(actor, row),
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
    return this.workflowActionsFor(actor, row);
  }

  // -------------------------------------------------------------- metadata edit

  async editMetadata(
    actor: RequestUser,
    id: string,
    input: UpdateDocumentMetadataInput,
  ): Promise<PublicDocument> {
    const current = await this.requireReadable(actor, id);
    if (!this.authorization.can(actor, this.asResource(current), 'DOCUMENT_EDIT'))
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
    const current = await this.requireReadable(actor, id);
    if (!this.authorization.can(actor, this.asResource(current), 'DOCUMENT_DELETE'))
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
    if (!this.authorization.can(actor, this.asResource(current), 'DOCUMENT_RESTORE'))
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
    const current = await this.requireReadable(actor, id);
    const capability = WORKFLOW_ACTION_CAPABILITIES[action];
    if (!this.authorization.can(actor, this.asResource(current), capability))
      throw new ForbiddenException('Action is not allowed');

    // Signing pins the version being signed; releasing checks that pin against the current
    // clean attachment. Scan state is read from the persisted file version.
    const currentClean = await this.cleanFlag(current);

    try {
      const result = this.workflow.execute(
        {
          id: current.id,
          status: current.status,
          version: current.version,
          direction: current.direction,
          hasCleanCurrentAttachment: currentClean,
          currentAttachmentVersionId: current.currentFileVersionId,
          signedAttachmentVersionId: current.signedFileVersionId,
        },
        { action, actorId: actor.id, ...input },
      );

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
    const current = await this.requireReadable(actor, documentId);
    if (!this.authorization.can(actor, this.asResource(current), 'DOCUMENT_ASSIGN'))
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
   * Forwards a document to another division (optionally a section within it): moves its owning
   * scope under the optimistic-version guard and records the hop in `document_routes`. Routing
   * to the current location is rejected as a no-op.
   */
  async route(actor: RequestUser, id: string, input: RouteDocumentInput): Promise<DocumentDetail> {
    const current = await this.requireReadable(actor, id);
    if (!this.authorization.can(actor, this.asResource(current), 'DOCUMENT_ASSIGN'))
      throw new ForbiddenException('Routing this document is not allowed');

    const toSectionId = input.toSectionId ?? null;
    if (current.divisionId === input.toDivisionId && current.sectionId === toSectionId)
      throw new BadRequestException({
        code: 'ROUTE_NO_OP',
        message: 'The document is already at that division and section',
      });
    const placement = await this.repository.resolvePlacement(input.toDivisionId, toSectionId);
    if (!placement.ok) throw new BadRequestException(placement.reason);

    await this.database.transaction(async (tx) => {
      const moved = await this.repository.relocate(
        id,
        input.expectedVersion,
        input.toDivisionId,
        toSectionId,
        tx,
      );
      if (moved === null) throw this.staleConflict();
      await this.repository.insertRoute(
        {
          documentId: id,
          fromDivisionId: current.divisionId,
          toDivisionId: input.toDivisionId,
          toSectionId,
          routedById: actor.id,
          remarks: input.remarks?.trim() ? input.remarks.trim() : null,
        },
        tx,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'document.routed',
          targetType: 'document',
          targetId: id,
          outcome: 'SUCCESS',
          summary: {
            fromDivisionId: current.divisionId,
            toDivisionId: input.toDivisionId,
            toSectionId,
          },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'document',
          aggregateId: id,
          eventType: 'document.routed',
          payload: { documentId: id, toDivisionId: input.toDivisionId, toSectionId },
          idempotencyKey: `document.routed:${id}:${moved.version}`,
        },
        tx,
      );
    });
    return this.getDocument(actor, id);
  }

  /** Grants one user read access to a document without moving or reassigning it. */
  async share(actor: RequestUser, id: string, userId: string): Promise<DocumentDetail> {
    const current = await this.requireReadable(actor, id);
    if (!this.authorization.can(actor, this.asResource(current), 'DOCUMENT_ASSIGN'))
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
    return rows
      .filter((row) => this.authorization.can(actor, this.asResource(row), 'DOCUMENT_RESTORE'))
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
      assigneeUserIds: [] as string[],
      sharedUserIds: [] as string[],
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
    const document = await this.requireReadable(actor, documentId);
    if (!this.authorization.can(actor, this.asResource(document), 'DOCUMENT_EDIT'))
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

  private workflowActionsFor(actor: RequestUser, row: DocumentRow): WorkflowAction[] {
    if (actor.role === 'VIEWER') return [];
    return this.workflow
      .allowedActions(
        {
          id: row.id,
          status: row.status,
          version: row.version,
          direction: row.direction,
          hasCleanCurrentAttachment: false,
          currentAttachmentVersionId: row.currentFileVersionId,
          signedAttachmentVersionId: row.signedFileVersionId,
        },
        actor.capabilities,
      )
      .filter((action) =>
        this.authorization.can(actor, this.asResource(row), WORKFLOW_ACTION_CAPABILITIES[action]),
      );
  }

  // The row is already proven readable by `findReadableById`, so its confidential/division/
  // section fields are all that `can` still needs; assignee/share membership only ever widens
  // read access, so leaving those arrays empty here can never grant an action it should deny.
  private asResource(row: DocumentRow) {
    return {
      id: row.id,
      divisionId: row.divisionId,
      sectionId: row.sectionId,
      assigneeUserIds: [] as string[],
      sharedUserIds: [] as string[],
      confidential: row.confidential,
    };
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
