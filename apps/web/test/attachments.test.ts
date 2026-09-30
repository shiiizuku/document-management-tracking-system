import { describe, expect, it } from 'vitest';
import { formatBytes, isDownloadable, scanBadge } from '../src/lib/attachments';

describe('scanBadge', () => {
  it('maps each scan status to a label and a tone', () => {
    expect(scanBadge('CLEAN')).toEqual({ label: 'Clean', tone: 'clean' });
    expect(scanBadge('PENDING')).toEqual({ label: 'Scan pending', tone: 'pending' });
    expect(scanBadge('INFECTED')).toEqual({ label: 'Infected', tone: 'infected' });
  });
});

describe('isDownloadable', () => {
  it('permits download only for a clean scan', () => {
    expect(isDownloadable('CLEAN')).toBe(true);
    for (const status of ['PENDING', 'SCANNING', 'INFECTED', 'ERROR'] as const) {
      expect(isDownloadable(status)).toBe(false);
    }
  });
});

describe('formatBytes', () => {
  it('scales bytes to a readable unit', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  });
});
