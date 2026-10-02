import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import type {
  FileRecordRow,
  FileScanStatus,
  FileVersionRow,
  NewFileVersion,
} from '../src/modules/files/file-versions.repository.js';
import { RELEASABLE_ATTACHMENT_MEDIA_TYPES } from '../src/modules/files/media-types.js';

const isFinalScanStatus = (status: FileScanStatus): boolean =>
  status === 'CLEAN' || status === 'INFECTED';

/**
 * Stand-in for {@link FileVersionsRepository} in the full-app REST suites (no database). It
 * mirrors the real repository's contracts: version numbering, the cross-document IDOR guard,
 * and scan-result immutability (a final result cannot change — a repeat is an idempotent
 * no-op, a different one a 409), so the HTTP behaviour is identical to Postgres.
 */
export class InMemoryFileVersionsRepository {
  private readonly records = new Map<string, FileRecordRow>();
  private readonly versions = new Map<string, FileVersionRow>();

  createRecord(values: {
    documentId: string;
    displayName: string;
    createdById: string;
  }): Promise<FileRecordRow> {
    const record: FileRecordRow = { id: randomUUID(), createdAt: new Date(), ...values };
    this.records.set(record.id, record);
    return Promise.resolve(record);
  }

  findRecordForDocument(documentId: string, fileRecordId: string): Promise<FileRecordRow | null> {
    const record = this.records.get(fileRecordId);
    return Promise.resolve(record && record.documentId === documentId ? record : null);
  }

  nextVersionNumber(fileRecordId: string): Promise<number> {
    const count = [...this.versions.values()].filter(
      (version) => version.fileRecordId === fileRecordId,
    ).length;
    return Promise.resolve(count + 1);
  }

  createVersion(values: NewFileVersion): Promise<FileVersionRow> {
    const version: FileVersionRow = {
      ...values,
      scanStatus: 'PENDING',
      administrativelyRestricted: false,
      uploadedAt: new Date(),
    };
    this.versions.set(version.id, version);
    return Promise.resolve(version);
  }

  findVersionById(versionId: string): Promise<FileVersionRow | null> {
    return Promise.resolve(this.versions.get(versionId) ?? null);
  }

  findVersionForDocument(documentId: string, versionId: string): Promise<FileVersionRow | null> {
    const version = this.versions.get(versionId);
    if (version === undefined) return Promise.resolve(null);
    const record = this.records.get(version.fileRecordId);
    return Promise.resolve(record?.documentId === documentId ? version : null);
  }

  listForDocument(
    documentId: string,
  ): Promise<{ attachmentId: string; versions: FileVersionRow[] }[]> {
    const grouped = new Map<string, FileVersionRow[]>();
    for (const version of this.versions.values()) {
      const record = this.records.get(version.fileRecordId);
      if (record?.documentId !== documentId) continue;
      const list = grouped.get(version.fileRecordId) ?? [];
      list.push(version);
      grouped.set(version.fileRecordId, list);
    }
    return Promise.resolve(
      [...grouped.entries()].map(([attachmentId, versions]) => ({
        attachmentId,
        versions: versions.sort((a, b) => a.versionNumber - b.versionNumber),
      })),
    );
  }

  recordScanStatus(
    versionId: string,
    status: Exclude<FileScanStatus, 'PENDING'>,
  ): Promise<{ version: FileVersionRow; changed: boolean }> {
    const version = this.versions.get(versionId);
    if (version === undefined) throw new NotFoundException('Attachment not found');
    if (version.scanStatus === status) return Promise.resolve({ version, changed: false });
    if (isFinalScanStatus(version.scanStatus))
      throw new ConflictException({
        code: 'SCAN_RESULT_CONFLICT',
        message: 'A final scan result cannot be changed',
      });
    const updated = { ...version, scanStatus: status };
    this.versions.set(versionId, updated);
    return Promise.resolve({ version: updated, changed: true });
  }

  isClean(versionId: string): Promise<boolean> {
    return Promise.resolve(this.versions.get(versionId)?.scanStatus === 'CLEAN');
  }

  isReleasable(versionId: string): Promise<boolean> {
    const version = this.versions.get(versionId);
    return Promise.resolve(
      version?.scanStatus === 'CLEAN' && RELEASABLE_ATTACHMENT_MEDIA_TYPES.has(version.mediaType),
    );
  }
}
