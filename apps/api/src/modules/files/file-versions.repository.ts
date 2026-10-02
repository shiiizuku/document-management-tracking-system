import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { fileRecords, fileVersions } from '../../database/schema.js';
import { RELEASABLE_ATTACHMENT_MEDIA_TYPES } from './media-types.js';

export type FileRecordRow = typeof fileRecords.$inferSelect;
export type FileVersionRow = typeof fileVersions.$inferSelect;
export type FileScanStatus = FileVersionRow['scanStatus'];

export interface NewFileVersion {
  id: string;
  fileRecordId: string;
  versionNumber: number;
  objectKey: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploaderId: string;
}

const isFinalScanStatus = (status: FileScanStatus): boolean =>
  status === 'CLEAN' || status === 'INFECTED';

/** The server-owned quarantine key for a version; never derived from client input. */
export const objectKeyFor = (
  fileRecordId: string,
  versionNumber: number,
  versionId: string,
): string => `quarantine/${fileRecordId}/${versionNumber}-${versionId}`;

/**
 * The Postgres home of attachment metadata: `file_records` (one per logical attachment of a
 * document) and their immutable `file_versions`. Bytes live behind the {@link StoragePort};
 * this repository owns everything about a version except the bytes themselves. Version rows are
 * never updated except to advance `scan_status` from a pending state to a final one — the
 * immutability the upload policy promises.
 */
@Injectable()
export class FileVersionsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async createRecord(
    values: { documentId: string; displayName: string; createdById: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<FileRecordRow> {
    const [row] = await executor.insert(fileRecords).values(values).returning();
    if (!row) throw new Error('Insert of a file record returned no row');
    return row;
  }

  /** Resolves an existing attachment (file record) of a document, for adding a new version. */
  async findRecordForDocument(
    documentId: string,
    fileRecordId: string,
  ): Promise<FileRecordRow | null> {
    const [row] = await this.database
      .select()
      .from(fileRecords)
      .where(and(eq(fileRecords.id, fileRecordId), eq(fileRecords.documentId, documentId)));
    return row ?? null;
  }

  async nextVersionNumber(
    fileRecordId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor
      .select({ max: sql<number>`coalesce(max(${fileVersions.versionNumber}), 0)` })
      .from(fileVersions)
      .where(eq(fileVersions.fileRecordId, fileRecordId));
    return (row?.max ?? 0) + 1;
  }

  async createVersion(
    values: NewFileVersion,
    executor: DatabaseExecutor = this.database,
  ): Promise<FileVersionRow> {
    const [row] = await executor.insert(fileVersions).values(values).returning();
    if (!row) throw new Error('Insert of a file version returned no row');
    return row;
  }

  async findVersionById(versionId: string): Promise<FileVersionRow | null> {
    const [row] = await this.database
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.id, versionId));
    return row ?? null;
  }

  /**
   * The IDOR guard: resolves a version only when it belongs to an attachment of `documentId`.
   * A valid version id from another document surfaces as `null`, exactly like an unknown id.
   */
  async findVersionForDocument(
    documentId: string,
    versionId: string,
  ): Promise<FileVersionRow | null> {
    const [row] = await this.database
      .select({ version: fileVersions })
      .from(fileVersions)
      .innerJoin(fileRecords, eq(fileRecords.id, fileVersions.fileRecordId))
      .where(and(eq(fileVersions.id, versionId), eq(fileRecords.documentId, documentId)));
    return row?.version ?? null;
  }

  async listForDocument(
    documentId: string,
  ): Promise<{ attachmentId: string; versions: FileVersionRow[] }[]> {
    const rows = await this.database
      .select({ version: fileVersions })
      .from(fileVersions)
      .innerJoin(fileRecords, eq(fileRecords.id, fileVersions.fileRecordId))
      .where(eq(fileRecords.documentId, documentId))
      .orderBy(asc(fileVersions.fileRecordId), asc(fileVersions.versionNumber));
    const grouped = new Map<string, FileVersionRow[]>();
    for (const { version } of rows) {
      const list = grouped.get(version.fileRecordId) ?? [];
      list.push(version);
      grouped.set(version.fileRecordId, list);
    }
    return [...grouped.entries()].map(([attachmentId, versions]) => ({ attachmentId, versions }));
  }

  /**
   * Advances a version's scan status. A final result (CLEAN/INFECTED) is immutable — a later,
   * different result is a conflict; the same result is an idempotent no-op. Returns whether the
   * stored status actually changed.
   */
  async recordScanStatus(
    versionId: string,
    status: Exclude<FileScanStatus, 'PENDING'>,
  ): Promise<{ version: FileVersionRow; changed: boolean }> {
    const current = await this.findVersionById(versionId);
    if (current === null) throw new NotFoundException('Attachment not found');
    if (current.scanStatus === status) return { version: current, changed: false };
    if (isFinalScanStatus(current.scanStatus))
      throw new ConflictException({
        code: 'SCAN_RESULT_CONFLICT',
        message: 'A final scan result cannot be changed',
      });
    const [row] = await this.database
      .update(fileVersions)
      .set({ scanStatus: status })
      .where(eq(fileVersions.id, versionId))
      .returning();
    if (!row) throw new NotFoundException('Attachment not found');
    return { version: row, changed: true };
  }

  async isClean(versionId: string): Promise<boolean> {
    const version = await this.findVersionById(versionId);
    return version?.scanStatus === 'CLEAN';
  }

  /**
   * Whether this version can carry a release: scanned clean **and** in a fixed form.
   *
   * Separate from {@link isClean} because the two answer different questions, and the difference
   * only appeared once Office documents became uploadable. A `.docx` can be perfectly clean and
   * still be the wrong thing to evidence an outgoing record with, since it is editable — so the
   * release gate asks this, and everything that only cares about malware asks `isClean`.
   */
  async isReleasable(versionId: string): Promise<boolean> {
    const version = await this.findVersionById(versionId);
    return (
      version?.scanStatus === 'CLEAN' && RELEASABLE_ATTACHMENT_MEDIA_TYPES.has(version.mediaType)
    );
  }
}
