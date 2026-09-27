import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnauthorizedException,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { compareSync, hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';
import type { CreateDocumentInput } from '@dts/contracts';
import { AuthorizationPolicy, type Role } from '../authorization/authorization.policy.js';
import {
  DocumentSearchService,
  type DocumentSearchQuery,
  type DocumentSearchResult,
  type SearchableDocument,
} from '../documents/document-search.service.js';
import {
  FileVersionService,
  type FileScanStatus,
  type FileVersion,
} from '../files/file-version.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { MonthlyReportService } from '../reports/monthly-report.service.js';
import {
  WORKFLOW_ACTION_CAPABILITIES,
  IllegalTransitionError,
  WorkflowConflictError,
  WorkflowRuleError,
  WorkflowService,
  type ReleaseMethod,
  type WorkflowAction,
  type WorkflowEvent,
} from '../workflow/workflow.service.js';
import type { RequestUser } from '../../common/request-user.js';

interface StoredUser extends RequestUser {
  passwordHash: string;
}
export interface DocumentRecord extends SearchableDocument {
  description: string | null;
  version: number;
  createdById: string;
  updatedAt: Date;
  dueAt: Date | null;
  deletedAt: Date | null;
  hasCleanCurrentAttachment: boolean;
  currentAttachmentVersionId: string | null;
  signedAttachmentVersionId: string | null;
  releaseMethod: ReleaseMethod | null;
}
export interface TimelineRecord extends WorkflowEvent {
  id: string;
  documentId: string;
  occurredAt: Date;
}
export interface AuditRecord {
  id: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  occurredAt: Date;
  correlationId: string;
  summary: Record<string, unknown>;
}

const capabilitiesByRole: Record<Role, readonly string[]> = {
  ADMINISTRATOR: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_RESTORE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
    'AUDIT_VIEW',
    'FILE_SCAN_RECORD',
  ],
  RECORDS_STAFF: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
    'FILE_SCAN_RECORD',
  ],
  DIVISION_HEAD: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
  ],
  STAFF_MEMBER: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
  ],
  VIEWER: [],
};

// Upload policy (Decisions 107/117): only formats that can be safely stored and later
// previewed inline, each with a well-known magic-byte signature so the real content type
// can be verified from the bytes rather than trusting the client's declared header.
export const ALLOWED_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// The client-facing shape of a file version. It deliberately omits `objectKey` so the
// internal storage layout (quarantine bucket paths) is never leaked over the API.
export interface PublicAttachmentVersion {
  id: string;
  attachmentId: string;
  versionNumber: number;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploaderId: string;
  uploadedAt: Date;
  scanStatus: FileScanStatus;
  isCurrent: boolean;
  isSigned: boolean;
}

@Injectable()
export class DtsApplicationService {
  readonly #users = new Map<string, StoredUser>();
  readonly #userIdByEmail = new Map<string, string>();
  readonly #documents = new Map<string, DocumentRecord>();
  readonly #timeline = new Map<string, TimelineRecord[]>();
  readonly #audit: AuditRecord[] = [];
  readonly #authorization = new AuthorizationPolicy();
  readonly #workflow = new WorkflowService();
  readonly #notifications = new NotificationService();
  readonly #search = new DocumentSearchService(this.#authorization);
  readonly #reports = new MonthlyReportService(this.#authorization);
  readonly #files = new FileVersionService();
  // In-memory stand-in for the private MinIO quarantine bucket: maps a version's
  // server-generated objectKey to its bytes. The metadata/immutability rules live in
  // #files; only the raw object bytes live here, mirroring the future storage boundary.
  readonly #objectStore = new Map<string, Uint8Array>();
  // documentId -> the fileRecordIds (attachments) that belong to it. A document may carry
  // several attachments, each an independently versioned file record.
  readonly #attachmentsByDocument = new Map<string, string[]>();
  #trackingSequence = 0;
  readonly #referenceSequence = new Map<string, number>();

  constructor() {
    this.seedUser(
      'records@dts.local',
      'Records@1234!',
      'Records Officer',
      'RECORDS_STAFF',
      'division-records',
      'section-intake',
      true,
    );
    this.seedUser(
      'staff@dts.local',
      'Staff@12345!',
      'Pilot Staff',
      'STAFF_MEMBER',
      'division-pilot',
      'section-pilot',
      false,
    );
    this.seedUser(
      'admin@dts.local',
      'Admin@1234!',
      'System Administrator',
      'ADMINISTRATOR',
      null,
      null,
      true,
    );
    this.seedUser(
      'viewer@dts.local',
      'Viewer@1234!',
      'Pilot Viewer',
      'VIEWER',
      'division-pilot',
      'section-pilot',
      false,
    );
  }

  authenticate(email: string, password: string): RequestUser {
    const userId = this.#userIdByEmail.get(email.trim().toLowerCase());
    const user = userId === undefined ? undefined : this.#users.get(userId);
    if (user === undefined || !user.active || !compareSync(password, user.passwordHash)) {
      throw new UnauthorizedException('Invalid email or password');
    }
    this.audit(user.id, 'AUTH_LOGIN', 'USER', user.id, 'SUCCESS', {});
    return this.publicUser(user);
  }

  getUser(id: string): RequestUser {
    const user = this.#users.get(id);
    if (user === undefined) throw new UnauthorizedException('User no longer exists');
    return this.publicUser(user);
  }

  createDocument(actor: RequestUser, input: CreateDocumentInput): DocumentRecord {
    if (!actor.capabilities.includes('DOCUMENT_CREATE'))
      throw new ForbiddenException('Document creation is not allowed');
    const now = new Date();
    const id = randomUUID();
    const year = now.getUTCFullYear();
    const trackingNumber = `DTS-${year}-${String(++this.#trackingSequence).padStart(6, '0')}`;
    let referenceNumber = input.referenceNumber ?? null;
    if (input.direction === 'OUTGOING') {
      const key = `${input.divisionId}:${year}`;
      const sequence = (this.#referenceSequence.get(key) ?? 0) + 1;
      this.#referenceSequence.set(key, sequence);
      const prefix =
        input.divisionId
          .replace(/[^A-Za-z0-9]/g, '')
          .slice(-8)
          .toUpperCase() || 'DIV';
      referenceNumber = `${prefix}-${year}-${String(sequence).padStart(5, '0')}`;
    }
    const record: DocumentRecord = {
      id,
      title: input.title,
      trackingNumber,
      referenceNumber,
      sender: input.sender ?? null,
      company: input.company ?? null,
      description: input.description ?? null,
      status: 'PENDING',
      priority: input.priority,
      type: input.type,
      direction: input.direction,
      divisionId: input.divisionId,
      sectionId: input.sectionId ?? null,
      assigneeUserIds: [],
      sharedUserIds: [],
      confidential: input.confidential,
      createdAt: now,
      updatedAt: now,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      version: 1,
      createdById: actor.id,
      deletedAt: null,
      hasCleanCurrentAttachment: false,
      currentAttachmentVersionId: null,
      signedAttachmentVersionId: null,
      releaseMethod: null,
    };
    this.#documents.set(id, record);
    this.#timeline.set(id, []);
    this.audit(actor.id, 'DOCUMENT_CREATED', 'DOCUMENT', id, 'SUCCESS', { trackingNumber });
    return record;
  }

  searchDocuments(actor: RequestUser, query: DocumentSearchQuery): DocumentSearchResult {
    return this.#search.execute(
      actor,
      [...this.#documents.values()].filter((d) => d.deletedAt === null),
      query,
    );
  }

  getDocument(
    actor: RequestUser,
    id: string,
  ): DocumentRecord & { timeline: TimelineRecord[]; allowedActions: WorkflowAction[] } {
    const document = this.requireDocument(id);
    if (!this.#authorization.canRead(actor, document))
      throw new NotFoundException('Document not found');
    return {
      ...document,
      timeline: [...(this.#timeline.get(id) ?? [])],
      allowedActions: this.allowedActions(actor, id),
    };
  }

  allowedActions(actor: RequestUser, id: string): WorkflowAction[] {
    const document = this.requireDocument(id);
    if (!this.#authorization.canRead(actor, document)) return [];
    return this.#workflow.allowedActions(document, actor.capabilities).filter((action) => {
      const capability = WORKFLOW_ACTION_CAPABILITIES[action];
      return this.#authorization.can(actor, document, capability);
    });
  }

  executeAction(
    actor: RequestUser,
    id: string,
    action: WorkflowAction,
    input: { expectedVersion: number; remarks?: string; releaseMethod?: ReleaseMethod },
  ): DocumentRecord {
    const current = this.requireDocument(id);
    const capability = WORKFLOW_ACTION_CAPABILITIES[action];
    if (!this.#authorization.can(actor, current, capability))
      throw new ForbiddenException('Action is not allowed');
    try {
      const result = this.#workflow.execute(current, { action, actorId: actor.id, ...input });
      let next: DocumentRecord = { ...current, ...result.document, updatedAt: new Date() };
      if (action === 'SIGN')
        next = { ...next, signedAttachmentVersionId: current.currentAttachmentVersionId };
      if (action === 'RELEASE') next = { ...next, releaseMethod: input.releaseMethod ?? null };
      this.#documents.set(id, next);
      const timelineRecord: TimelineRecord = {
        ...result.event,
        id: randomUUID(),
        documentId: id,
        occurredAt: new Date(),
      };
      this.#timeline.set(id, [...(this.#timeline.get(id) ?? []), timelineRecord]);
      this.audit(actor.id, `WORKFLOW_${action}`, 'DOCUMENT', id, 'SUCCESS', {
        from: current.status,
        to: next.status,
      });
      return next;
    } catch (error) {
      this.audit(actor.id, `WORKFLOW_${action}`, 'DOCUMENT', id, 'FAILURE', {
        status: current.status,
      });
      // Map the workflow's typed errors onto a precise HTTP contract; anything unrecognized
      // is a genuine fault and is rethrown so the filter reports it as a 500.
      if (error instanceof WorkflowConflictError)
        throw new ConflictException({ code: 'WORKFLOW_CONFLICT', message: error.message });
      if (error instanceof IllegalTransitionError)
        throw new ConflictException({ code: 'ILLEGAL_TRANSITION', message: error.message });
      if (error instanceof WorkflowRuleError)
        throw new UnprocessableEntityException({ code: error.code, message: error.message });
      throw error;
    }
  }

  assign(actor: RequestUser, documentId: string, recipientUserId: string): DocumentRecord {
    const current = this.requireDocument(documentId);
    if (!this.#authorization.can(actor, current, 'DOCUMENT_ASSIGN'))
      throw new ForbiddenException('Assignment is not allowed');
    const recipient = this.getUser(recipientUserId);
    const next = {
      ...current,
      assigneeUserIds: [...new Set([...current.assigneeUserIds, recipient.id])],
      version: current.version + 1,
      updatedAt: new Date(),
    };
    this.#documents.set(documentId, next);
    this.#notifications.create({
      recipientUserId,
      type: 'DOCUMENT_ASSIGNED',
      title: 'Document assigned',
      body: `${current.trackingNumber}: ${current.title}`,
      documentId,
      idempotencyKey: `assignment:${documentId}:${recipientUserId}:${next.version}`,
    });
    this.audit(actor.id, 'DOCUMENT_ASSIGNED', 'DOCUMENT', documentId, 'SUCCESS', {
      recipientUserId,
    });
    return next;
  }

  async uploadAttachment(
    actor: RequestUser,
    documentId: string,
    file: { buffer: Uint8Array; originalName: string },
    attachmentId?: string,
  ): Promise<PublicAttachmentVersion> {
    const document = this.requireDocument(documentId);
    if (!this.#authorization.can(actor, document, 'DOCUMENT_EDIT'))
      throw new ForbiddenException('Uploading attachments is not allowed');
    // Evidence integrity: a released or archived record's attachments are frozen.
    if (document.status === 'RELEASED' || document.status === 'ARCHIVED')
      throw new ConflictException({
        code: 'DOCUMENT_NOT_EDITABLE',
        message: 'Attachments cannot be added to a released or archived document',
      });

    if (file.buffer.byteLength === 0)
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Uploaded file is empty' });
    if (file.buffer.byteLength > MAX_ATTACHMENT_BYTES)
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit`,
      });
    // Trust the bytes, not the client's declared Content-Type: sniff the real media type
    // from magic bytes and validate that against the allow-list (defeats type spoofing).
    const detected = await fileTypeFromBuffer(file.buffer);
    if (detected === undefined || !ALLOWED_ATTACHMENT_MEDIA_TYPES.has(detected.mime))
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Attachment type is not one of the supported formats',
      });

    // A provided attachmentId adds a new version to an existing attachment of THIS document;
    // otherwise a fresh attachment record is created. Cross-document ids are rejected.
    const existing = this.#attachmentsByDocument.get(documentId) ?? [];
    let fileRecordId: string;
    if (attachmentId !== undefined) {
      if (!existing.includes(attachmentId)) throw new NotFoundException('Attachment not found');
      fileRecordId = attachmentId;
    } else {
      fileRecordId = randomUUID();
    }

    const version = this.#files.createVersion({
      fileRecordId,
      bytes: file.buffer,
      originalName: file.originalName,
      mediaType: detected.mime,
      uploaderId: actor.id,
    });
    this.#objectStore.set(version.objectKey, file.buffer);
    if (!existing.includes(fileRecordId))
      this.#attachmentsByDocument.set(documentId, [...existing, fileRecordId]);

    // The newest upload becomes the document's "current" attachment and resets clean-state:
    // a new attachment must be re-scanned, and it can no longer match a prior signature —
    // which is exactly what the outgoing-release invariant checks. Bumping the document
    // version guards against signing a document whose evidence changed underneath.
    const next: DocumentRecord = {
      ...document,
      currentAttachmentVersionId: version.id,
      hasCleanCurrentAttachment: false,
      version: document.version + 1,
      updatedAt: new Date(),
    };
    this.#documents.set(documentId, next);
    this.audit(actor.id, 'ATTACHMENT_UPLOADED', 'DOCUMENT', documentId, 'SUCCESS', {
      attachmentId: fileRecordId,
      versionId: version.id,
      versionNumber: version.versionNumber,
      mediaType: version.mediaType,
      sizeBytes: version.sizeBytes,
    });
    return this.publicAttachmentVersion(version, next);
  }

  listAttachments(
    actor: RequestUser,
    documentId: string,
  ): { attachmentId: string; versions: PublicAttachmentVersion[] }[] {
    const document = this.requireDocument(documentId);
    if (!this.#authorization.canRead(actor, document))
      throw new NotFoundException('Document not found');
    return (this.#attachmentsByDocument.get(documentId) ?? []).map((attachmentId) => ({
      attachmentId,
      versions: this.#files
        .listVersions(attachmentId)
        .map((version) => this.publicAttachmentVersion(version, document)),
    }));
  }

  downloadAttachment(
    actor: RequestUser,
    documentId: string,
    versionId: string,
  ): { fileName: string; mediaType: string; bytes: Uint8Array } {
    const document = this.requireDocument(documentId);
    if (!this.#authorization.canRead(actor, document))
      throw new NotFoundException('Document not found');
    const version = this.attachmentVersionForDocument(document, versionId);
    // Fail-closed: the domain service is the authority on whether bytes may leave the
    // quarantine boundary. Translate its plain errors into a stable HTTP contract so a
    // not-yet-clean file surfaces as a deliberate 409, never a masked 500.
    try {
      this.#files.getDownloadable(version.id, true);
    } catch (error) {
      if (error instanceof Error && error.message === 'File is not clean')
        throw new ConflictException({
          code: 'FILE_NOT_CLEAN',
          message: 'Attachment is unavailable until it passes malware scanning',
        });
      throw new NotFoundException('Attachment not found');
    }
    const bytes = this.#objectStore.get(version.objectKey);
    if (bytes === undefined) throw new NotFoundException('Attachment content not found');
    this.audit(actor.id, 'ATTACHMENT_DOWNLOADED', 'DOCUMENT', documentId, 'SUCCESS', {
      versionId: version.id,
    });
    return { fileName: version.originalName, mediaType: version.mediaType, bytes };
  }

  recordAttachmentScan(
    actor: RequestUser,
    documentId: string,
    versionId: string,
    status: Exclude<FileScanStatus, 'PENDING'>,
  ): PublicAttachmentVersion {
    const document = this.requireDocument(documentId);
    if (!this.#authorization.canRead(actor, document))
      throw new NotFoundException('Document not found');
    if (!actor.capabilities.includes('FILE_SCAN_RECORD'))
      throw new ForbiddenException('Recording scan results is not allowed');
    const version = this.attachmentVersionForDocument(document, versionId);
    let changed: boolean;
    try {
      changed = this.#files.recordScanResult(version.id, status);
    } catch (error) {
      throw new ConflictException({
        code: 'SCAN_RESULT_CONFLICT',
        message: error instanceof Error ? error.message : 'Scan result cannot be changed',
      });
    }
    const updated = this.#files.getVersion(version.id);
    // Reflect clean-state onto the document only when the scanned version is the current
    // one, so the release invariant sees an accurate hasCleanCurrentAttachment flag.
    let effectiveDocument = document;
    if (document.currentAttachmentVersionId === version.id) {
      effectiveDocument = {
        ...document,
        hasCleanCurrentAttachment: updated.scanStatus === 'CLEAN',
        updatedAt: new Date(),
      };
      this.#documents.set(documentId, effectiveDocument);
    }
    this.audit(actor.id, 'ATTACHMENT_SCAN_RECORDED', 'DOCUMENT', documentId, 'SUCCESS', {
      versionId: version.id,
      scanStatus: updated.scanStatus,
      changed,
    });
    return this.publicAttachmentVersion(updated, effectiveDocument);
  }

  listNotifications(actor: RequestUser, afterCursor = 0) {
    return this.#notifications.list(actor.id, afterCursor);
  }
  unreadNotificationCount(actor: RequestUser): number {
    return this.#notifications.unreadCount(actor.id);
  }
  markNotificationRead(actor: RequestUser, id: string) {
    return this.#notifications.markRead(actor.id, id);
  }

  monthlyReport(actor: RequestUser, year: number, month: number) {
    if (!actor.capabilities.includes('REPORT_VIEW'))
      throw new ForbiddenException('Report access is not allowed');
    const report = this.#reports.calculate(actor, [...this.#documents.values()], year, month);
    this.audit(actor.id, 'REPORT_MONTHLY_VIEWED', 'REPORT', `${year}-${month}`, 'SUCCESS', {
      year,
      month,
    });
    return report;
  }

  auditEvents(actor: RequestUser): AuditRecord[] {
    if (!actor.capabilities.includes('AUDIT_VIEW'))
      throw new ForbiddenException('Audit access is not allowed');
    return [...this.#audit].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  }

  listUsers(actor: RequestUser): RequestUser[] {
    if (!actor.capabilities.includes('DOCUMENT_ASSIGN'))
      throw new ForbiddenException('User lookup is not allowed');
    return [...this.#users.values()]
      .filter((user) => user.active)
      .map((user) => this.publicUser(user));
  }

  private seedUser(
    email: string,
    password: string,
    displayName: string,
    role: Role,
    divisionId: string | null,
    sectionId: string | null,
    canAccessConfidential: boolean,
  ): void {
    const id = randomUUID();
    const user: StoredUser = {
      id,
      email,
      displayName,
      role,
      divisionId,
      sectionId,
      capabilities: capabilitiesByRole[role],
      canAccessConfidential,
      active: true,
      passwordHash: hashSync(password, 12),
    };
    this.#users.set(id, user);
    this.#userIdByEmail.set(email.toLowerCase(), id);
  }

  private publicUser(user: StoredUser): RequestUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      divisionId: user.divisionId,
      sectionId: user.sectionId,
      capabilities: user.capabilities,
      canAccessConfidential: user.canAccessConfidential,
      active: user.active,
    };
  }

  private requireDocument(id: string): DocumentRecord {
    const document = this.#documents.get(id);
    if (document === undefined || document.deletedAt !== null)
      throw new NotFoundException('Document not found');
    return document;
  }

  // Resolves a version id but only if it belongs to an attachment of the given document.
  // This is the IDOR guard: a valid version id from another document must not be reachable
  // through this document's path, and a caller already proven able to read `document`
  // learns nothing about ids outside it (unknown/foreign ids both surface as 404).
  private attachmentVersionForDocument(document: DocumentRecord, versionId: string): FileVersion {
    const attachmentIds = this.#attachmentsByDocument.get(document.id) ?? [];
    let version: FileVersion;
    try {
      version = this.#files.getVersion(versionId);
    } catch {
      throw new NotFoundException('Attachment not found');
    }
    if (!attachmentIds.includes(version.fileRecordId))
      throw new NotFoundException('Attachment not found');
    return version;
  }

  private publicAttachmentVersion(
    version: FileVersion,
    document: DocumentRecord,
  ): PublicAttachmentVersion {
    return {
      id: version.id,
      attachmentId: version.fileRecordId,
      versionNumber: version.versionNumber,
      originalName: version.originalName,
      mediaType: version.mediaType,
      sizeBytes: version.sizeBytes,
      checksumSha256: version.checksumSha256,
      uploaderId: version.uploaderId,
      uploadedAt: version.uploadedAt,
      scanStatus: version.scanStatus,
      isCurrent: document.currentAttachmentVersionId === version.id,
      isSigned: document.signedAttachmentVersionId === version.id,
    };
  }

  private audit(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
    outcome: 'SUCCESS' | 'FAILURE',
    summary: Record<string, unknown>,
  ): void {
    this.#audit.push({
      id: randomUUID(),
      actorId,
      action,
      targetType,
      targetId,
      outcome,
      occurredAt: new Date(),
      correlationId: randomUUID(),
      summary,
    });
  }
}
