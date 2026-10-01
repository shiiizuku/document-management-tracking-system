import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Joins class names and resolves Tailwind conflicts so the last one wins.
 *
 * Every component in `components/ui` takes a `className` that has to be able to override the
 * component's own utilities — `cn('px-4', 'px-6')` must yield `px-6`, which plain concatenation
 * cannot guarantee. This is shadcn's helper, kept at the path `components.json` points at so
 * generated components resolve it unchanged.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * How a SCREAMING_SNAKE enum value reads to a person: `RECORDS_STAFF` becomes "Records staff".
 *
 * The API serves roles, account-request statuses and release methods as enum members, and four
 * screens plus the account menu need the same sentence-cased rendering of them. Mechanical rather
 * than a lookup table on purpose — a hand-written label per member would be a second vocabulary to
 * keep in step with the contract's, and these names are already written to be read.
 *
 * Display only. Authority is never derived from one of these strings; capabilities decide that.
 */
export function enumLabel(value: string): string {
  const words = value.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
