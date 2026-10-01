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
