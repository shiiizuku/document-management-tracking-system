import { describe, expect, it, vi } from 'vitest';
import { scanUploadedVersion, type ScanConsumerDeps } from '../src/modules/files/scan-consumer.js';
import type { ScanVerdict } from '../src/modules/files/clamav-scanner.js';
import type { FileVersionRow } from '../src/modules/files/file-versions.repository.js';

const versionRow = (overrides: Partial<FileVersionRow> = {}): FileVersionRow =>
  ({
    id: 'v1',
    objectKey: 'quarantine/r1/1-v1',
    scanStatus: 'PENDING',
    ...overrides,
  }) as FileVersionRow;

interface Harness {
  deps: ScanConsumerDeps;
  recordScanStatus: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
}

const harness = (opts: {
  version: FileVersionRow | null;
  bytes?: Uint8Array | null;
  verdict?: ScanVerdict;
}): Harness => {
  const recordScanStatus = vi.fn((_id: string, status: ScanVerdict) =>
    Promise.resolve({ version: versionRow({ scanStatus: status }), changed: true }),
  );
  const scan = vi.fn(() => Promise.resolve<ScanVerdict>(opts.verdict ?? 'CLEAN'));
  const write = vi.fn(() => Promise.resolve());
  const deps: ScanConsumerDeps = {
    versions: {
      findVersionById: vi.fn(() => Promise.resolve(opts.version)),
      recordScanStatus,
    },
    storage: {
      get: vi.fn(() => Promise.resolve('bytes' in opts ? opts.bytes! : new Uint8Array([1, 2, 3]))),
    },
    scanner: { scan },
    audit: { write },
  };
  return { deps, recordScanStatus, scan, write };
};

describe('scanUploadedVersion', () => {
  it.each(['PENDING_RETRY', 'SCAN_FAILED'] as const)(
    'scans a version stuck in %s, which has no verdict yet',
    async (scanStatus) => {
      const h = harness({ version: versionRow({ scanStatus }), verdict: 'CLEAN' });
      expect(await scanUploadedVersion(h.deps, 'v1')).toEqual({
        status: 'scanned',
        verdict: 'CLEAN',
      });
      expect(h.recordScanStatus).toHaveBeenCalledWith('v1', 'CLEAN');
    },
  );

  it('records CLEAN for a benign upload and audits it', async () => {
    const h = harness({ version: versionRow(), verdict: 'CLEAN' });
    const outcome = await scanUploadedVersion(h.deps, 'v1');
    expect(outcome).toEqual({ status: 'scanned', verdict: 'CLEAN' });
    expect(h.recordScanStatus).toHaveBeenCalledWith('v1', 'CLEAN');
    expect(h.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attachment.scanned', summary: { scanStatus: 'CLEAN' } }),
    );
  });

  it('records INFECTED without leaving the version downloadable', async () => {
    const h = harness({ version: versionRow(), verdict: 'INFECTED' });
    const outcome = await scanUploadedVersion(h.deps, 'v1');
    expect(outcome).toEqual({ status: 'scanned', verdict: 'INFECTED' });
    expect(h.recordScanStatus).toHaveBeenCalledWith('v1', 'INFECTED');
  });

  it('is idempotent: skips a version that already reached a final status', async () => {
    const h = harness({ version: versionRow({ scanStatus: 'CLEAN' }) });
    const outcome = await scanUploadedVersion(h.deps, 'v1');
    expect(outcome).toEqual({ status: 'skipped', reason: 'already-scanned' });
    expect(h.scan).not.toHaveBeenCalled();
    expect(h.recordScanStatus).not.toHaveBeenCalled();
  });

  it('skips an unknown version instead of retrying forever', async () => {
    const h = harness({ version: null });
    const outcome = await scanUploadedVersion(h.deps, 'gone');
    expect(outcome).toEqual({ status: 'skipped', reason: 'not-found' });
    expect(h.scan).not.toHaveBeenCalled();
  });

  it('throws when bytes are not yet stored, so the job retries', async () => {
    const h = harness({ version: versionRow(), bytes: null });
    await expect(scanUploadedVersion(h.deps, 'v1')).rejects.toThrow(/bytes not yet available/);
    expect(h.recordScanStatus).not.toHaveBeenCalled();
  });
});
