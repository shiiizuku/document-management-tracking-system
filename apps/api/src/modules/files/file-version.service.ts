import { createHash, randomUUID } from 'node:crypto';

export type FileScanStatus = 'PENDING' | 'PENDING_RETRY' | 'CLEAN' | 'INFECTED' | 'SCAN_FAILED';

export interface FileVersion {
  readonly id: string;
  readonly fileRecordId: string;
  readonly versionNumber: number;
  readonly objectKey: string;
  readonly originalName: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly uploaderId: string;
  readonly uploadedAt: Date;
  readonly scanStatus: FileScanStatus;
}

export interface CreateFileVersionInput {
  fileRecordId: string;
  bytes: Uint8Array;
  originalName: string;
  mediaType: string;
  uploaderId: string;
}

const isFinalScanStatus = (status: FileScanStatus): boolean =>
  status === 'CLEAN' || status === 'INFECTED';

export class FileVersionService {
  readonly #versions = new Map<string, FileVersion>();
  readonly #versionIdsByFile = new Map<string, string[]>();

  createVersion(input: CreateFileVersionInput): FileVersion {
    const existing = this.#versionIdsByFile.get(input.fileRecordId) ?? [];
    const versionNumber = existing.length + 1;
    const id = randomUUID();
    const version: FileVersion = Object.freeze({
      id,
      fileRecordId: input.fileRecordId,
      versionNumber,
      objectKey: `quarantine/${input.fileRecordId}/${versionNumber}-${id}`,
      originalName: input.originalName,
      mediaType: input.mediaType,
      sizeBytes: input.bytes.byteLength,
      checksumSha256: createHash('sha256').update(input.bytes).digest('hex'),
      uploaderId: input.uploaderId,
      uploadedAt: new Date(),
      scanStatus: 'PENDING',
    });

    this.#versions.set(id, version);
    this.#versionIdsByFile.set(input.fileRecordId, [...existing, id]);
    return version;
  }

  listVersions(fileRecordId: string): FileVersion[] {
    return (this.#versionIdsByFile.get(fileRecordId) ?? []).map((id) => this.requireVersion(id));
  }

  recordScanResult(versionId: string, scanStatus: Exclude<FileScanStatus, 'PENDING'>): boolean {
    const existing = this.requireVersion(versionId);
    if (existing.scanStatus === scanStatus) {
      return false;
    }
    if (isFinalScanStatus(existing.scanStatus)) {
      throw new Error('A final scan result cannot be changed');
    }

    this.#versions.set(versionId, Object.freeze({ ...existing, scanStatus }));
    return true;
  }

  getDownloadable(versionId: string, authorized: boolean): FileVersion {
    if (!authorized) {
      throw new Error('File access denied');
    }
    const version = this.requireVersion(versionId);
    if (version.scanStatus !== 'CLEAN') {
      throw new Error('File is not clean');
    }
    return version;
  }

  getVersion(versionId: string): FileVersion {
    return this.requireVersion(versionId);
  }

  private requireVersion(versionId: string): FileVersion {
    const version = this.#versions.get(versionId);
    if (version === undefined) {
      throw new Error('File version not found');
    }
    return version;
  }
}
