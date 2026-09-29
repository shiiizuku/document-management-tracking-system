import { Injectable, NotFoundException } from '@nestjs/common';
import {
  FileVersionService,
  type FileScanStatus,
  type FileVersion,
} from './file-version.service.js';

/**
 * The in-memory prototype of the private attachment store. It owns three things that Phase 4
 * (Files & scanning) will move to real infrastructure:
 *
 *  - version metadata + immutability rules ({@link FileVersionService}),
 *  - the raw object bytes (`#objectStore`, the stand-in for the MinIO quarantine bucket),
 *  - which attachments belong to which document (`#attachmentsByDocument`).
 *
 * The `documents` row itself is already persistent — it points at the current/signed version
 * by id — so this store only holds what has not yet been migrated. Extracting it from the old
 * application service lets both the documents module (for the release clean-check) and the
 * files module share one source of attachment truth.
 */
@Injectable()
export class AttachmentStore {
  readonly #files = new FileVersionService();
  readonly #objectStore = new Map<string, Uint8Array>();
  readonly #attachmentsByDocument = new Map<string, string[]>();

  /**
   * Adds a new version. With `attachmentId` it versions an existing attachment of THIS
   * document (a cross-document id is rejected); without one it starts a fresh attachment.
   */
  createVersion(
    documentId: string,
    input: { bytes: Uint8Array; originalName: string; mediaType: string; uploaderId: string },
    attachmentId?: string,
  ): FileVersion {
    const existing = this.#attachmentsByDocument.get(documentId) ?? [];
    let fileRecordId: string;
    if (attachmentId !== undefined) {
      if (!existing.includes(attachmentId)) throw new NotFoundException('Attachment not found');
      fileRecordId = attachmentId;
    } else {
      fileRecordId = crypto.randomUUID();
    }

    const version = this.#files.createVersion({
      fileRecordId,
      bytes: input.bytes,
      originalName: input.originalName,
      mediaType: input.mediaType,
      uploaderId: input.uploaderId,
    });
    this.#objectStore.set(version.objectKey, input.bytes);
    if (!existing.includes(fileRecordId))
      this.#attachmentsByDocument.set(documentId, [...existing, fileRecordId]);
    return version;
  }

  listForDocument(documentId: string): { attachmentId: string; versions: FileVersion[] }[] {
    return (this.#attachmentsByDocument.get(documentId) ?? []).map((attachmentId) => ({
      attachmentId,
      versions: this.#files.listVersions(attachmentId),
    }));
  }

  /**
   * The IDOR guard: resolves a version only when it belongs to an attachment of `documentId`.
   * A valid version id from another document surfaces as a 404, exactly like an unknown id, so
   * a caller learns nothing about ids outside the document they were allowed to read.
   */
  versionForDocument(documentId: string, versionId: string): FileVersion {
    const attachmentIds = this.#attachmentsByDocument.get(documentId) ?? [];
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

  /** Throws unless the version exists and has passed scanning; the download fail-closed gate. */
  requireDownloadable(versionId: string): { version: FileVersion; bytes: Uint8Array } {
    const version = this.#files.getDownloadable(versionId, true);
    const bytes = this.#objectStore.get(version.objectKey);
    if (bytes === undefined) throw new NotFoundException('Attachment content not found');
    return { version, bytes };
  }

  recordScan(
    versionId: string,
    status: Exclude<FileScanStatus, 'PENDING'>,
  ): {
    version: FileVersion;
    changed: boolean;
  } {
    const changed = this.#files.recordScanResult(versionId, status);
    return { version: this.#files.getVersion(versionId), changed };
  }

  /** Whether a version has passed scanning, without throwing — used by the release invariant. */
  isVersionClean(versionId: string): boolean {
    try {
      return this.#files.getVersion(versionId).scanStatus === 'CLEAN';
    } catch {
      return false;
    }
  }
}
