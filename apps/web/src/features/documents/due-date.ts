/**
 * Due dates, between the date a person picks and the instant the contract carries.
 *
 * `createDocumentSchema` and the metadata patch both type `dueAt` as an ISO datetime, but a due
 * date is a day — nobody sets a deadline of 14:32. The conversion lives here so the create form
 * and the edit form cannot disagree about which instant a given day means, which they would
 * within a week if each did it inline.
 *
 * Policy register P-04: overdue is counted in **elapsed calendar days**, with no working-hours or
 * holiday calendar.
 */

/**
 * The instant a chosen day expires: the last millisecond of it, in UTC.
 *
 * End of day rather than the start, so a document due today is not already overdue this morning.
 * Counting from the start would make every deadline expire the moment it was set, which is the
 * one reading nobody means by "due on the 14th".
 */
export const dueDateToIso = (day: string): string | undefined =>
  day === '' ? undefined : new Date(`${day}T23:59:59.999Z`).toISOString();

/** The `YYYY-MM-DD` an `<input type="date">` shows for a stored instant. */
export const isoToDueDate = (iso: string | null | undefined): string =>
  iso === null || iso === undefined ? '' : iso.slice(0, 10);

/**
 * Whole calendar days between a due date and now: negative before it, positive once it has passed.
 *
 * Days rather than hours because that is the unit the office counts in, and whole days because a
 * deadline that reads "2 days late" must not flicker to "3 days late" depending on the hour the
 * page is opened. Both instants are floored to their UTC day first, so the answer depends only on
 * the dates involved.
 */
export const daysElapsedSince = (iso: string, now: Date = new Date()): number => {
  const dayMs = 24 * 60 * 60 * 1000;
  const due = Date.parse(iso);
  if (Number.isNaN(due)) return 0;
  return Math.floor(now.getTime() / dayMs) - Math.floor(due / dayMs);
};

/** Whether a due date has passed. The workflow status decides whether that still matters. */
export const isPastDue = (iso: string | null, now: Date = new Date()): boolean =>
  iso !== null && daysElapsedSince(iso, now) > 0;

/**
 * How a due date reads beside a document: "due in 3 days", "due today", "4 days overdue".
 *
 * One function rather than a value plus a format call at each site, because the wording and the
 * sign have to stay in step — "-4 days" is not something to put in front of a records clerk.
 */
export const dueLabel = (iso: string | null, now: Date = new Date()): string | null => {
  if (iso === null) return null;
  const elapsed = daysElapsedSince(iso, now);
  if (elapsed > 0) return `${elapsed} ${elapsed === 1 ? 'day' : 'days'} overdue`;
  if (elapsed === 0) return 'Due today';
  const remaining = -elapsed;
  return `Due in ${remaining} ${remaining === 1 ? 'day' : 'days'}`;
};
