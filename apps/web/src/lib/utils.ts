import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The fifteen MD3 type roles, as tailwind-merge needs to be told about them.
 *
 * tailwind-merge works from a built-in map of Tailwind's own scale, so `text-label-large` is a name
 * it has never seen. Faced with an unknown `text-*`, it files it under the text-COLOUR group — and
 * then `cn('text-label-large', 'text-primary-foreground')` looks like two colours, the last wins,
 * and the font size is silently dropped. That is not hypothetical: it is exactly what happened to
 * the button, which rendered at 400 weight and body tracking until this was added.
 *
 * Listing the roles under `font-size` fixes both halves at once — a size no longer collides with a
 * colour, and two sizes still collapse correctly, so `cn('text-body-medium', 'text-title-large')`
 * yields the title.
 *
 * This list is the one place that has to be kept in step with the `--text-*` tokens in
 * md3-theme.css. A role added there and forgotten here does not error; it goes missing at runtime
 * the moment something sets a colour alongside it.
 */
const MD3_TYPE_ROLES = [
  'display-large',
  'display-medium',
  'display-small',
  'headline-large',
  'headline-medium',
  'headline-small',
  'title-large',
  'title-medium',
  'title-small',
  'body-large',
  'body-medium',
  'body-small',
  'label-large',
  'label-medium',
  'label-small',
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: [...MD3_TYPE_ROLES] }],
      // The MD3 shadow pairs. Without this, `shadow-md3-1` and `shadow-md3-2` would not be seen as
      // the same group, so the elevated button's `hover:shadow-md3-2` could not override its base.
      shadow: [{ shadow: ['md3-1', 'md3-2', 'md3-3', 'md3-4', 'md3-5'] }],
      // The MD3 shape scale, so `rounded-md3-lg` conflicts with `rounded-full` as it should.
      rounded: [{ rounded: ['md3-none', 'md3-xs', 'md3-sm', 'md3-md', 'md3-lg', 'md3-xl'] }],
      /*
       * The MD3 easings. Same failure mode as the type roles, one step quieter: tailwind-merge
       * knows only `ease-linear` / `ease-initial` / arbitrary, so `ease-standard` is unrecognised
       * and falls through ungrouped — `cn('ease-standard', 'ease-linear')` keeps BOTH, and which
       * one wins is left to stylesheet order rather than to the caller. The overlays now pass a
       * different easing per direction, so this group has to exist for an override to work.
       *
       * The durations need no entry: `duration-(--md-duration-short-2)` is an arbitrary value in
       * a group tailwind-merge already has, and it collapses correctly.
       */
      ease: [
        {
          ease: [
            'standard',
            'standard-decelerate',
            'standard-accelerate',
            'emphasized',
            'emphasized-decelerate',
            'emphasized-accelerate',
          ],
        },
      ],
    },
  },
});

/**
 * Joins class names and resolves Tailwind conflicts so the last one wins.
 *
 * Every component in `components/ui` takes a `className` that has to be able to override the
 * component's own utilities — `cn('px-4', 'px-6')` must yield `px-6`, which plain concatenation
 * cannot guarantee. This is shadcn's helper, kept at the path `components.json` points at so
 * generated components resolve it unchanged, extended above for the MD3 scales.
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
