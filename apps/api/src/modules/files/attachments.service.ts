import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { RequestUser } from '../../common/request-user.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { OutboxWriter } from '../audit/outbox.writer.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { DocumentRow } from '../documents/documents.repository.js';
import {
  FileVersionsRepository,
  objectKeyFor,
  type FileScanStatus,
  type FileVersionRow,
} from './file-versions.repository.js';
import { StoragePort } from './storage.port.js';

// Upload policy (decisions 107/117): only formats that can be stored safely and previewed
// inline, each with a well-known magic-byte signature so the true content type is verified
// from the bytes rather than trusting the client's declared header.
export const ALLOWED_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * The formats a browser is asked to render in place rather than hand over as a file.
 *
 * Derived from the upload allow-list rather than listed again, because every format the system
 * accepts is one it accepted *because* it can be previewed safely (decision 117). As a derivation
 * a new upload format cannot quietly become previewable by omission — narrowing this set later is
 * then a deliberate edit.
 */
export const PREVIEWABLE_ATTACHMENT_MEDIA_TYPES: ReadonlySet<string> =
  ALLOWED_ATTACHMENT_MEDIA_TYPES;

/** Bytes leaving the service for a caller to render or save, with what they are and were called. */
export interface AttachmentContent {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

// The client-facing shape of a file version. It omits `objectKey` so the internal storage
// layout (quarantine bucket paths) is never leaked over the API.
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

/**
 * Attachment use cases. As of Phase 4 the version metadata is persistent
 * ({@link FileVersionsRepository}) and the bytes live behind the {@link StoragePort}; the
 * document row (which version is current/signed, whether the record is frozen) is owned by
 * {@link DocumentsService}. This service is the seam that keeps the three consistent.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly documents: DocumentsService,
    private readonly versions: FileVersionsRepository,
    private readonly storage: StoragePort,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  async upload(
    actor: RequestUser,
    documentId: string,
    file: { buffer: Uint8Array; originalName: string },
    attachmentId?: string,
  ): Promise<PublicAttachmentVersion> {
    await this.documents.requireEditableDocument(actor, documentId);

    if (file.buffer.byteLength === 0)
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Uploaded file is empty' });
    if (file.buffer.byteLength > MAX_ATTACHMENT_BYTES)
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte limit`,
      });
    // Trust the bytes, not the declared Content-Type: sniff the real media type from magic
    // bytes and validate that against the allow-list (defeats type spoofing).
    const detected = await fileTypeFromBuffer(file.buffer);
    if (detected === undefined || !ALLOWED_ATTACHMENT_MEDIA_TYPES.has(detected.mime))
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Attachment type is not one of the supported formats',
      });

    // A provided attachmentId adds a version to an existing attachment of THIS document; a
    // cross-document id is rejected. Otherwise a fresh attachment (file record) is started.
    if (attachmentId !== undefined) {
      const record = await this.versions.findRecordForDocument(documentId, attachmentId);
      if (record === null) throw new NotFoundException('Attachment not found');
    }
    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const versionId = randomUUID();

    const version = await this.database.transaction(async (tx) => {
      const fileRecordId =
        attachmentId ??
        (
          await this.versions.createRecord(
            { documentId, displayName: file.originalName, createdById: actor.id },
            tx,
          )
        ).id;
      const versionNumber = await this.versions.nextVersionNumber(fileRecordId, tx);
      return this.versions.createVersion(
        {
          id: versionId,
          fileRecordId,
          versionNumber,
          objectKey: objectKeyFor(fileRecordId, versionNumber, versionId),
          originalName: file.originalName,
          mediaType: detected.mime,
          sizeBytes: file.buffer.byteLength,
          checksumSha256,
          uploaderId: actor.id,
        },
        tx,
      );
    });
    // Bytes land after the metadata commits, under the server-generated key (never overwritten).
    await this.storage.put(version.objectKey, file.buffer);

    // The newest upload becomes the document's current attachment and resets clean-state: a new
    // version starts PENDING (so it is not downloadable and no longer matches a prior signature),
    // which is exactly what the outgoing-release invariant checks. Bumping the row version guards
    // against signing a document whose evidence changed underneath.
    const document = await this.documents.setCurrentAttachment(documentId, version.id);
    await this.audit.write({
      actorId: actor.id,
      action: 'attachment.uploaded',
      targetType: 'document',
      targetId: documentId,
      outcome: 'SUCCESS',
      summary: {
        attachmentId: version.fileRecordId,
        versionId: version.id,
        versionNumber: version.versionNumber,
        mediaType: version.mediaType,
        sizeBytes: version.sizeBytes,
      },
    });
    // Request a malware scan now that the bytes are stored. Enqueued after `put` (not inside the
    // metadata transaction) so the worker never races ahead of the bytes it must read; the key
    // makes a retried upload idempotent, and the version stays PENDING — undownloadable — until
    // the worker records a result, so a lost event fails safe rather than leaking an unscanned file.
    await this.outbox.enqueue({
      aggregateType: 'file-version',
      aggregateId: version.id,
      eventType: 'attachment.uploaded',
      payload: { documentId, versionId: version.id, objectKey: version.objectKey },
      idempotencyKey: `attachment.uploaded:${version.id}`,
    });
    return this.toPublic(version, document);
  }

  async list(
    actor: RequestUser,
    documentId: string,
  ): Promise<{ attachmentId: string; versions: PublicAttachmentVersion[] }[]> {
    const document = await this.documents.requireReadableDocument(actor, documentId);
    const grouped = await this.versions.listForDocument(documentId);
    return grouped.map((entry) => ({
      attachmentId: entry.attachmentId,
      versions: entry.versions.map((version) => this.toPublic(version, document)),
    }));
  }

  async download(
    actor: RequestUser,
    documentId: string,
    versionId: string,
  ): Promise<AttachmentContent> {
    return this.readCleanBytes(actor, documentId, versionId, 'attachment.downloaded');
  }

  /**
   * The same bytes, served to be rendered in place rather than saved.
   *
   * Deliberately a separate use case rather than a flag on {@link download}: the two differ in
   * what they may serve (only formats a browser renders without a plugin) and in what they record
   * — reading a document on screen and taking a copy of it away are different events in the
   * trail. The quarantine rule is shared, because a preview discloses the bytes just as fully.
   */
  async preview(
    actor: RequestUser,
    documentId: string,
    versionId: string,
  ): Promise<AttachmentContent> {
    const content = await this.readCleanBytes(actor, documentId, versionId, 'attachment.previewed');
    // Checked after the read, not before it, so the refusal cannot be used to probe for versions:
    // an unreadable document and an unpreviewable one are both reached through the checks above.
    if (!PREVIEWABLE_ATTACHMENT_MEDIA_TYPES.has(content.mediaType))
      throw new UnsupportedMediaTypeException({
        code: 'PREVIEW_UNSUPPORTED',
        message: 'This file type cannot be previewed in the browser',
      });
    return content;
  }

  /**
   * The read path behind {@link download} and {@link preview}: authorize the document, find the
   * version, refuse anything the scanner has not cleared, fetch the bytes, record the action.
   *
   * One method, so the fail-closed check cannot be present on one route and missing from the
   * other — which is exactly the mistake a second copy of this sequence invites.
   */
  private async readCleanBytes(
    actor: RequestUser,
    documentId: string,
    versionId: string,
    action: 'attachment.downloaded' | 'attachment.previewed',
  ): Promise<AttachmentContent> {
    await this.documents.requireReadableDocument(actor, documentId);
    const version = await this.versions.findVersionForDocument(documentId, versionId);
    if (version === null) throw new NotFoundException('Attachment not found');
    // Fail-closed: bytes never leave the quarantine boundary until the version is CLEAN.
    if (version.scanStatus !== 'CLEAN')
      throw new ConflictException({
        code: 'FILE_NOT_CLEAN',
        message: 'Attachment is unavailable until it passes malware scanning',
      });
    const bytes = await this.storage.get(version.objectKey);
    if (bytes === null) throw new NotFoundException('Attachment content not found');
    await this.audit.write({
      actorId: actor.id,
      action,
      targetType: 'document',
      targetId: documentId,
      outcome: 'SUCCESS',
      summary: { versionId: version.id, mediaType: version.mediaType },
    });
    return { fileName: version.originalName, mediaType: version.mediaType, bytes };
  }

  async recordScan(
    actor: RequestUser,
    documentId: string,
    versionId: string,
    status: Exclude<FileScanStatus, 'PENDING'>,
  ): Promise<PublicAttachmentVersion> {
    const document = await this.documents.requireReadableDocument(actor, documentId);
    if (!actor.capabilities.includes('FILE_SCAN_RECORD'))
      throw new ForbiddenException('Recording scan results is not allowed');
    const version = await this.versions.findVersionForDocument(documentId, versionId);
    if (version === null) throw new NotFoundException('Attachment not found');
    // The repository enforces immutability of a final result and raises a 409 on a change.
    const result = await this.versions.recordScanStatus(version.id, status);
    await this.audit.write({
      actorId: actor.id,
      action: 'attachment.scan-recorded',
      targetType: 'document',
      targetId: documentId,
      outcome: 'SUCCESS',
      summary: {
        versionId: version.id,
        scanStatus: result.version.scanStatus,
        changed: result.changed,
      },
    });
    return this.toPublic(result.version, document);
  }

  private toPublic(version: FileVersionRow, document: DocumentRow): PublicAttachmentVersion {
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
      isCurrent: document.currentFileVersionId === version.id,
      isSigned: document.signedFileVersionId === version.id,
    };
  }
}
