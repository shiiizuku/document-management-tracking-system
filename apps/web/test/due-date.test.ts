import { describe, expect, it } from 'vitest';
import {
  daysElapsedSince,
  dueDateToIso,
  dueLabel,
  isPastDue,
  isoToDueDate,
} from '../src/features/documents/due-date';

/*
 * Policy register P-04: overdue is counted in whole elapsed calendar days, with no working-hours
 * or holiday calendar. These assertions are that rule and nothing more — if the office later
 * agrees a working calendar, this file is where the change shows up first.
 */
describe('due dates', () => {
  it('pins a chosen day to the end of it, so a document is not overdue on the day it is due', () => {
    expect(dueDateToIso('2026-10-02')).toBe('2026-10-02T23:59:59.999Z');
    // Midday on the due date is still inside it.
    expect(isPastDue(dueDateToIso('2026-10-02') ?? null, new Date('2026-10-02T12:00:00Z'))).toBe(
      false,
    );
    expect(isPastDue(dueDateToIso('2026-10-02') ?? null, new Date('2026-10-03T00:00:01Z'))).toBe(
      true,
    );
  });

  it('round-trips through the date input', () => {
    expect(isoToDueDate('2026-10-02T23:59:59.999Z')).toBe('2026-10-02');
    expect(isoToDueDate(null)).toBe('');
    expect(dueDateToIso('')).toBeUndefined();
  });

  /*
   * Whole days, floored per UTC day. A deadline that reads "2 days late" must not become "3 days
   * late" because the page was opened in the evening rather than the morning.
   */
  it('counts whole days, not hours', () => {
    const due = '2026-10-02T23:59:59.999Z';
    expect(daysElapsedSince(due, new Date('2026-10-04T00:30:00Z'))).toBe(2);
    expect(daysElapsedSince(due, new Date('2026-10-04T23:30:00Z'))).toBe(2);
    expect(daysElapsedSince(due, new Date('2026-10-01T06:00:00Z'))).toBe(-1);
  });

  it('reads the way a clerk would say it', () => {
    const due = '2026-10-02T23:59:59.999Z';
    expect(dueLabel(due, new Date('2026-10-02T09:00:00Z'))).toBe('Due today');
    expect(dueLabel(due, new Date('2026-10-03T09:00:00Z'))).toBe('1 day overdue');
    expect(dueLabel(due, new Date('2026-10-06T09:00:00Z'))).toBe('4 days overdue');
    expect(dueLabel(due, new Date('2026-09-30T09:00:00Z'))).toBe('Due in 2 days');
    expect(dueLabel(null)).toBeNull();
  });

  // A document with no target date is not overdue; it has no deadline to miss.
  it('treats an absent date as never overdue', () => {
    expect(isPastDue(null)).toBe(false);
    expect(dueLabel(null)).toBeNull();
  });
});
