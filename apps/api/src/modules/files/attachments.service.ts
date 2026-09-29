import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { fileTypeFromBuffer } from 'file-type';
import type { RequestUser } from '../../common/request-user.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { DocumentsService } from '../documents/documents.service.js';
import type { DocumentRow } from '../documents/documents.repository.js';
import { AttachmentStore } from './attachment-store.js';
import type { FileScanStatus, FileVersion } from './file-version.service.js';

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
 * Attachment use cases. The document row (which version is current/signed, whether the record
 * is frozen) lives in Postgres and is owned by {@link DocumentsService}; the version metadata
 * and bytes still live in the in-memory {@link AttachmentStore} until Phase 4 swaps it for
 * MinIO + a scan worker. This service is the seam between the two.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly documents: DocumentsService,
    private readonly store: AttachmentStore,
    private readonly audit: AuditWriter,
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

    const version = this.store.createVersion(
      documentId,
      {
        bytes: file.buffer,
        originalName: file.originalName,
        mediaType: detected.mime,
        uploaderId: actor.id,
      },
      attachmentId,
    );

    // The newest upload becomes the document's current attachment and resets clean-state: a
    // new version starts PENDING (so `isVersionClean` is false) and can no longer match a
    // prior signature — exactly what the outgoing-release invariant checks. Bumping the row
    // version guards against signing a document whose evidence changed underneath.
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
    return this.toPublic(version, document);
  }

  async list(
    actor: RequestUser,
    documentId: string,
  ): Promise<{ attachmentId: string; versions: PublicAttachmentVersion[] }[]> {
    const document = await this.documents.requireReadableDocument(actor, documentId);
    return this.store.listForDocument(documentId).map((entry) => ({
      attachmentId: entry.attachmentId,
      versions: entry.versions.map((version) => this.toPublic(version, document)),
    }));
  }

  async download(
    actor: RequestUser,
    documentId: string,
    versionId: string,
  ): Promise<{ fileName: string; mediaType: string; bytes: Uint8Array }> {
    await this.documents.requireReadableDocument(actor, documentId);
    const version = this.store.versionForDocument(documentId, versionId);
    // Fail-closed: the store is the authority on whether bytes may leave the quarantine
    // boundary. Translate its plain error into a stable 409 so a not-yet-clean file is a
    // deliberate refusal, never a masked 500.
    let downloadable: { version: FileVersion; bytes: Uint8Array };
    try {
      downloadable = this.store.requireDownloadable(version.id);
    } catch (error) {
      if (error instanceof Error && error.message === 'File is not clean')
        throw new ConflictException({
          code: 'FILE_NOT_CLEAN',
          message: 'Attachment is unavailable until it passes malware scanning',
        });
      throw new NotFoundException('Attachment not found');
    }
    await this.audit.write({
      actorId: actor.id,
      action: 'attachment.downloaded',
      targetType: 'document',
      targetId: documentId,
      outcome: 'SUCCESS',
      summary: { versionId: version.id },
    });
    return {
      fileName: downloadable.version.originalName,
      mediaType: downloadable.version.mediaType,
      bytes: downloadable.bytes,
    };
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
    const version = this.store.versionForDocument(documentId, versionId);
    let result: { version: FileVersion; changed: boolean };
    try {
      result = this.store.recordScan(version.id, status);
    } catch (error) {
      throw new ConflictException({
        code: 'SCAN_RESULT_CONFLICT',
        message: error instanceof Error ? error.message : 'Scan result cannot be changed',
      });
    }
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

  private toPublic(version: FileVersion, document: DocumentRow): PublicAttachmentVersion {
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
