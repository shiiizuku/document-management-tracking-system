import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import {
  ALLOWED_ATTACHMENT_MEDIA_TYPES,
  PREVIEWABLE_ATTACHMENT_MEDIA_TYPES,
  UNSUPPORTED_MEDIA_TYPE_MESSAGE,
} from './media-types.js';

// The media-type policy (allow-list, previewable, releasable, and the refusal message) lives in
// ./media-types.js so the file-versions repository can enforce the release gate without closing an
// import cycle through this service. Re-exported here because callers already import it from the
// service, and a format question has one answer whichever door it comes through.
export {
  ALLOWED_ATTACHMENT_MEDIA_TYPES,
  MAX_ATTACHMENT_BYTES,
  PREVIEWABLE_ATTACHMENT_MEDIA_TYPES,
  RELEASABLE_ATTACHMENT_MEDIA_TYPES,
  UNSUPPORTED_MEDIA_TYPE_MESSAGE,
} from './media-types.js';

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
  /**
   * The effective upload ceiling, read once at construction.
   *
   * `MAX_ATTACHMENT_BYTES` is the hard ceiling the multipart parser is wired with (a decorator
   * argument, fixed at module load); `UPLOAD_MAX_BYTES` is the deployment's own limit and may only
   * narrow it, which boot validation enforces. Reading it here is what makes the variable live:
   * configuring 5 MiB used to validate at boot and then change nothing.
   */
  readonly #maxBytes: number;
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly documents: DocumentsService,
    private readonly versions: FileVersionsRepository,
    private readonly storage: StoragePort,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
    config: ConfigService,
  ) {
    this.#maxBytes = config.getOrThrow<number>('UPLOAD_MAX_BYTES');
  }

  async upload(
    actor: RequestUser,
    documentId: string,
    file: { buffer: Uint8Array; originalName: string },
    attachmentId?: string,
  ): Promise<PublicAttachmentVersion> {
    await this.documents.requireEditableDocument(actor, documentId);

    if (file.buffer.byteLength === 0)
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Uploaded file is empty' });
    if (file.buffer.byteLength > this.#maxBytes)
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `Attachment exceeds the ${this.#maxBytes}-byte limit`,
      });
    // Trust the bytes, not the declared Content-Type: sniff the real media type from magic
    // bytes and validate that against the allow-list (defeats type spoofing).
    const detected = await fileTypeFromBuffer(file.buffer);
    if (detected === undefined || !ALLOWED_ATTACHMENT_MEDIA_TYPES.has(detected.mime))
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: UNSUPPORTED_MEDIA_TYPE_MESSAGE,
      });

    // A provided attachmentId adds a version to an existing attachment of THIS document; a
    // cross-document id is rejected. Otherwise a fresh attachment (file record) is started.
    if (attachmentId !== undefined) {
      const record = await this.versions.findRecordForDocument(documentId, attachmentId);
      if (record === null) throw new NotFoundException('Attachment not found');
    }
    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const versionId = randomUUID();

    // The object key is server-generated from ids that exist only in memory until the commit, so
    // the bytes can land first. A failed commit then leaves an unreferenced object (garbage that
    // no row points at) rather than metadata pointing at bytes that were never written.
    const fileRecordId = attachmentId ?? randomUUID();
    const versionNumber =
      attachmentId === undefined ? 1 : await this.versions.nextVersionNumber(attachmentId);
    const objectKey = objectKeyFor(fileRecordId, versionNumber, versionId);
    await this.storage.put(objectKey, file.buffer);

    try {
      // One transaction: the version, the document's pointer to it, the audit record and the scan
      // request commit together or not at all. The pointer update re-checks that the document is
      // still editable, so a release or archive since the check above rolls everything back.
      return await this.database.transaction(async (tx) => {
        if (attachmentId === undefined)
          await this.versions.createRecord(
            {
              id: fileRecordId,
              documentId,
              displayName: file.originalName,
              createdById: actor.id,
            },
            tx,
          );
        // Another upload to the same attachment can take the number between the read above and
        // here; the key must match the number the row gets, or the bytes would be unreachable.
        if ((await this.versions.nextVersionNumber(fileRecordId, tx)) !== versionNumber)
          throw new ConflictException({
            code: 'UPLOAD_CONFLICT',
            message: 'The attachment changed while uploading; try again',
          });
        const version = await this.versions.createVersion(
          {
            id: versionId,
            fileRecordId,
            versionNumber,
            objectKey,
            originalName: file.originalName,
            mediaType: detected.mime,
            sizeBytes: file.buffer.byteLength,
            checksumSha256,
            uploaderId: actor.id,
          },
          tx,
        );
        // The newest upload becomes the document's current attachment and resets clean-state: a
        // new version starts PENDING (so it is not downloadable and no longer matches a prior
        // signature), which is exactly what the outgoing-release invariant checks. Bumping the row
        // version guards against signing a document whose evidence changed underneath.
        const document = await this.documents.setCurrentAttachment(documentId, version.id, tx);
        await this.audit.write(
          {
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
          },
          tx,
        );
        // The version stays PENDING (undownloadable) until the worker records a result, so a
        // lost event fails safe rather than leaking an unscanned file. The key makes a retried
        // upload idempotent.
        await this.outbox.enqueue(
          {
            aggregateType: 'file-version',
            aggregateId: version.id,
            eventType: 'attachment.uploaded',
            payload: { documentId, versionId: version.id, objectKey: version.objectKey },
            idempotencyKey: `attachment.uploaded:${version.id}`,
          },
          tx,
        );
        return this.toPublic(version, document);
      });
    } catch (error) {
      // Best effort: nothing references these bytes now. A failure here only leaves garbage.
      await this.storage.delete(objectKey).catch((cleanupError: unknown) => {
        this.logger.warn(
          `could not remove orphaned object ${objectKey}: ${
            cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
          }`,
        );
      });
      throw error;
    }
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

  /**
   * Asks the scanner to look at a version again. There is deliberately no way to *submit* a
   * verdict: a result is only ever what ClamAV said about the stored bytes (policy P-07), so an
   * operator whose scan was lost can requeue it but cannot declare the file clean.
   *
   * A version that already has a final result is returned unchanged; the scan worker also skips
   * non-pending versions, so a repeated request is harmless.
   */
  async requestRescan(
    actor: RequestUser,
    documentId: string,
    versionId: string,
  ): Promise<PublicAttachmentVersion> {
    const document = await this.documents.requireReadableDocument(actor, documentId);
    if (!actor.capabilities.includes('FILE_SCAN_RECORD'))
      throw new ForbiddenException('Requesting a rescan is not allowed');
    const version = await this.versions.findVersionForDocument(documentId, versionId);
    if (version === null) throw new NotFoundException('Attachment not found');
    if (version.scanStatus !== 'PENDING') return this.toPublic(version, document);
    await this.database.transaction(async (tx) => {
      // A fresh key per request: the upload's own key is already in the outbox and would be
      // dropped as a duplicate.
      await this.outbox.enqueue(
        {
          aggregateType: 'file-version',
          aggregateId: version.id,
          eventType: 'attachment.uploaded',
          payload: { documentId, versionId: version.id, objectKey: version.objectKey },
          idempotencyKey: `attachment.rescan:${version.id}:${randomUUID()}`,
        },
        tx,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'attachment.rescan-requested',
          targetType: 'document',
          targetId: documentId,
          outcome: 'SUCCESS',
          summary: { versionId: version.id },
        },
        tx,
      );
    });
    return this.toPublic(version, document);
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
