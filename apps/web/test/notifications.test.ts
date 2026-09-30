import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/lib/notifications';

describe('relativeTime', () => {
  const now = Date.parse('2026-09-30T12:00:00Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('reads very recent times as "just now"', () => {
    expect(relativeTime(ago(10_000), now)).toBe('just now');
  });

  it('scales through minutes, hours, days and weeks', () => {
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d ago');
    expect(relativeTime(ago(2 * 7 * 86_400_000), now)).toBe('2w ago');
  });

  it('falls back to a locale date beyond a month and tolerates bad input', () => {
    expect(relativeTime(ago(60 * 86_400_000), now)).not.toMatch(/ago|just now/);
    expect(relativeTime('not-a-date', now)).toBe('');
  });
});
