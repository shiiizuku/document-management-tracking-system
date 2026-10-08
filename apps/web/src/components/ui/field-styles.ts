import { cn } from '@/lib/utils';

/*
 * The two field sizes every text input, select and date input uses (Civic Ledger handoff,
 * "Fields"). One table rather than per-component classes, so the shadcn `SelectTrigger` and a plain
 * `Input` set beside it in a filter row cannot drift a pixel apart.
 *
 * - `form`: sign-in, dialogs and admin forms. 48px tall, 12px radius, 16px text — 16px also keeps
 *   iOS from zooming the page on focus.
 * - `filter`: search and filter bars above a list, where several sit in a row. 44px, 10px, 15px.
 *
 * Both have the same 14px inset, a 1.5px `--input` border and a surface fill. Focus is a 2px outline
 * in `--ring` with a 2px offset; an invalid field gets a 2px destructive border.
 */
export type FieldSize = 'form' | 'filter';

const SIZE: Record<FieldSize, string> = {
  form: 'h-12 rounded-xl text-base',
  filter: 'h-11 rounded-[10px] text-[15px]',
};

export const fieldClasses = (size: FieldSize, className?: string) =>
  cn(
    'w-full min-w-0 border-[1.5px] border-input bg-card px-3.5 text-foreground',
    'transition-[color,border-color] outline-none placeholder:text-muted-foreground',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'disabled:cursor-not-allowed disabled:opacity-50',
    'aria-invalid:border-2 aria-invalid:border-destructive',
    SIZE[size],
    className,
  );

/** Where a drawn chevron or calendar icon sits, and the padding that keeps text clear of it. */
export const FIELD_ICON =
  'pointer-events-none absolute top-1/2 right-4 size-4 -translate-y-1/2 text-muted-foreground';
export const FIELD_ICON_PADDING = 'pr-11';
