import type { ReactNode } from 'react';

/**
 * The top of every screen: an eyebrow, a title, an optional count, and the screen's primary
 * action on the right.
 *
 * Every route needs this and every route would otherwise build it slightly differently — a
 * different heading size here, the action above the title there. One component keeps the routes
 * visually interchangeable and makes a change to the convention a single edit.
 */
export function PageHeader({
  eyebrow,
  title,
  count,
  description,
  actions,
}: Readonly<{
  eyebrow: string;
  title: string;
  /** Shown beside the title when the screen is a list whose size matters. */
  count?: number | undefined;
  description?: string | undefined;
  actions?: ReactNode;
}>) {
  return (
    <header data-slot="page-header" className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="mt-2 flex items-baseline gap-3 font-display text-[2.75rem] leading-[1.05] font-normal text-foreground">
          <span className="truncate">{title}</span>
          {count === undefined ? null : (
            <span className="font-sans text-base font-semibold text-muted-foreground tabular-nums">
              {count.toLocaleString()}
            </span>
          )}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-[15px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
