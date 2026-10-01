import type { ComponentType, ReactNode, SVGProps } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one way this app says "there is nothing here".
 *
 * An empty list, a filter that matched nothing, and a screen the user may not open are all the
 * same shape: an icon, a line that says what happened, a line that says what to do about it, and
 * an optional way to do it. Centralising it stops each screen inventing its own blank area, and
 * keeps the distinction between "nothing yet" and "nothing matching" a matter of the copy a
 * caller passes rather than of layout.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: Readonly<{
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/60 px-6 py-14 text-center',
        className,
      )}
    >
      {Icon ? (
        <span className="flex size-11 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <h3 className="text-lg text-foreground">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-muted-foreground">{description}</p> : null}
      {action}
    </div>
  );
}
