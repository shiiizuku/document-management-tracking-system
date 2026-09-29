import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FileVersionService } from '../src/modules/files/file-version.service.js';

describe('FileVersionService public seam', () => {
  it('creates immutable monotonically numbered versions with independent checksums', () => {
    const files = new FileVersionService();
    const firstBytes = Buffer.from('first version');
    const secondBytes = Buffer.from('second version');

    const first = files.createVersion({
      fileRecordId: 'file-1',
      bytes: firstBytes,
      originalName: 'memo.pdf',
      mediaType: 'application/pdf',
      uploaderId: 'user-1',
    });
    const second = files.createVersion({
      fileRecordId: 'file-1',
      bytes: secondBytes,
      originalName: 'memo.pdf',
      mediaType: 'application/pdf',
      uploaderId: 'user-2',
    });

    expect(first.versionNumber).toBe(1);
    expect(second.versionNumber).toBe(2);
    expect(first.id).not.toBe(second.id);
    expect(first.objectKey).not.toBe(second.objectKey);
    expect(first.checksumSha256).toBe(createHash('sha256').update(firstBytes).digest('hex'));
    expect(second.checksumSha256).toBe(createHash('sha256').update(secondBytes).digest('hex'));
    expect(files.listVersions('file-1').map((version) => version.checksumSha256)).toEqual([
      first.checksumSha256,
      second.checksumSha256,
    ]);
  });

  it('fails closed until the version has a clean scan result', () => {
    const files = new FileVersionService();
    const version = files.createVersion({
      fileRecordId: 'file-1',
      bytes: Buffer.from('safe document'),
      originalName: 'memo.pdf',
      mediaType: 'application/pdf',
      uploaderId: 'user-1',
    });

    expect(() => files.getDownloadable(version.id, true)).toThrowError('File is not clean');
    files.recordScanResult(version.id, 'CLEAN');
    expect(files.getDownloadable(version.id, true).id).toBe(version.id);
  });

  it.each(['INFECTED', 'SCAN_FAILED', 'PENDING_RETRY'] as const)(
    'does not expose %s versions',
    (scanStatus) => {
      const files = new FileVersionService();
      const version = files.createVersion({
        fileRecordId: 'file-1',
        bytes: Buffer.from('blocked'),
        originalName: 'blocked.pdf',
        mediaType: 'application/pdf',
        uploaderId: 'user-1',
      });
      files.recordScanResult(version.id, scanStatus);
      expect(() => files.getDownloadable(version.id, true)).toThrowError('File is not clean');
    },
  );

  it('does not expose a clean file to an unauthorized caller', () => {
    const files = new FileVersionService();
    const version = files.createVersion({
      fileRecordId: 'file-1',
      bytes: Buffer.from('safe'),
      originalName: 'safe.pdf',
      mediaType: 'application/pdf',
      uploaderId: 'user-1',
    });
    files.recordScanResult(version.id, 'CLEAN');
    expect(() => files.getDownloadable(version.id, false)).toThrowError('File access denied');
  });

  it('makes duplicate scan delivery idempotent', () => {
    const files = new FileVersionService();
    const version = files.createVersion({
      fileRecordId: 'file-1',
      bytes: Buffer.from('safe'),
      originalName: 'safe.pdf',
      mediaType: 'application/pdf',
      uploaderId: 'user-1',
    });
    expect(files.recordScanResult(version.id, 'CLEAN')).toBe(true);
    expect(files.recordScanResult(version.id, 'CLEAN')).toBe(false);
    expect(() => files.recordScanResult(version.id, 'INFECTED')).toThrowError(
      'A final scan result cannot be changed',
    );
  });
});
