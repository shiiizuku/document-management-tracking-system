import type { ScanVerdict } from './clamav-scanner.js';
import type { FileVersionRow } from './file-versions.repository.js';

/**
 * The slice of each collaborator the scan consumer needs. Narrow structural types (rather than the
 * concrete classes) keep this unit-testable with fakes and keep the worker's wiring honest about
 * what it actually calls.
 */
export interface ScanConsumerDeps {
  versions: {
    findVersionById(versionId: string): Promise<FileVersionRow | null>;
    recordScanStatus(
      versionId: string,
      status: ScanVerdict,
    ): Promise<{ version: FileVersionRow; changed: boolean }>;
  };
  storage: { get(key: string): Promise<Uint8Array | null> };
  scanner: { scan(bytes: Uint8Array): Promise<ScanVerdict> };
  audit?: {
    write(entry: {
      actorId: string | null;
      action: string;
      targetType: string;
      targetId: string;
      outcome: 'SUCCESS' | 'FAILURE';
      summary?: Record<string, unknown>;
    }): Promise<void>;
  };
  logger?: { log(message: string): void; warn(message: string): void };
}

export type ScanOutcome =
  | { status: 'scanned'; verdict: ScanVerdict }
  | { status: 'skipped'; reason: 'not-found' | 'already-scanned' };

/**
 * Scans one uploaded version and records the verdict. Idempotent: a version that already reached a
 * final scan status is left untouched (a redelivered event is a no-op), and a missing version is
 * skipped rather than retried forever. Absent bytes throw, so BullMQ retries — this covers the
 * brief window between the metadata commit and the byte write on the upload path.
 */
export const scanUploadedVersion = async (
  deps: ScanConsumerDeps,
  versionId: string,
): Promise<ScanOutcome> => {
  const version = await deps.versions.findVersionById(versionId);
  if (version === null) {
    deps.logger?.warn(`scan skipped: version ${versionId} not found`);
    return { status: 'skipped', reason: 'not-found' };
  }
  if (version.scanStatus !== 'PENDING') {
    return { status: 'skipped', reason: 'already-scanned' };
  }
  const bytes = await deps.storage.get(version.objectKey);
  if (bytes === null)
    throw new Error(`bytes not yet available for version ${versionId}; will retry`);

  const verdict = await deps.scanner.scan(bytes);
  await deps.versions.recordScanStatus(versionId, verdict);
  await deps.audit?.write({
    actorId: null,
    action: 'attachment.scanned',
    targetType: 'file-version',
    targetId: versionId,
    outcome: 'SUCCESS',
    summary: { scanStatus: verdict },
  });
  deps.logger?.log(`scanned version ${versionId}: ${verdict}`);
  return { status: 'scanned', verdict };
};
