'use client';

import type { ReactNode } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The chrome around a server-paginated list, and the one place that decides which of its four
 * states it is in.
 *
 * Pulled out of `DataTable` when the registry gained card and single-line views (decision 173).
 * The four states — loading, empty, error, rows — and the pager arithmetic are the same four and
 * the same arithmetic whatever a row looks like, and three renderers each answering them from
 * their own copy would disagree within a month, most visibly on the edges: "Page 1 of 1" for an
 * empty result set, or a card grid that drops its pager while refetching.
 *
 * What it does **not** own is where those states are drawn. A table paints its empty state inside
 * a cell spanning every column, beneath a header that stays put; a card grid paints it as a plain
 * block. So the state is computed here and handed to the body, which places it.
 *
 * Paging is *reported*, never performed: the server applied the scope rules that decide which
 * records exist, so slicing in the browser would page a window rather than the result set.
 */

export type ListState = 'loading' | 'empty' | 'rows';

export interface ListShellProps {
  /** Total matching rows on the server — not the length of this page. */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Rows on this page. Only used to tell `empty` from `rows`. */
  rowCount: number;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  /**
   * The body, for the state the shell resolved. The caller places the empty and loading states
   * itself — a table draws them inside a cell spanning every column, a card grid as a plain block
   * — which is exactly the part that cannot be shared.
   */
  children: (state: ListState) => ReactNode;
  /** The card frame around the body. Off for the line view, which draws its own rules. */
  framed?: boolean;
  className?: string;
}

export function ListShell({
  total,
  page,
  pageSize,
  onPageChange,
  rowCount,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  children,
  framed = true,
  className,
}: ListShellProps) {
  if (error !== undefined && error !== null) {
    return <ListError error={error} onRetry={onRetry} />;
  }

  // At least one page, so "Page 1 of 1" reads correctly for an empty result set.
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, total);
  const state: ListState = isLoading ? 'loading' : rowCount === 0 ? 'empty' : 'rows';

  return (
    <div className={cn('space-y-3', className)}>
      <div
        data-slot={framed ? 'list-frame' : 'list-body'}
        className={cn(
          'transition-opacity',
          framed && 'overflow-x-auto rounded-2xl border border-border bg-card',
          // A refetch keeps the current page on screen and dims it rather than replacing it with
          // skeletons: flipping the whole list back to a loading state on every filter change
          // reads as a slower app than one showing briefly stale rows.
          isFetching && !isLoading && 'opacity-60',
        )}
      >
        {children(state)}
      </div>

      {/* Stays mounted while loading so the footer does not jump as rows arrive. */}
      <nav
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm"
        aria-label="Pagination"
      >
        <p className="text-muted-foreground tabular-nums">
          {total === 0
            ? 'No results'
            : `Showing ${firstOnPage.toLocaleString()}–${lastOnPage.toLocaleString()} of ${total.toLocaleString()}`}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          <span className="px-1 text-muted-foreground tabular-nums">
            Page {page.toLocaleString()} of {pageCount.toLocaleString()}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        </div>
      </nav>
    </div>
  );
}

/**
 * A failed list. Shows what the server said, offers one retry, and surfaces the correlation ID
 * when there is one — the only thing that lets support find the request in the logs.
 */
export function ListError({
  error,
  onRetry,
}: Readonly<{ error: unknown; onRetry?: (() => void) | undefined }>) {
  const apiError = error instanceof ApiError ? error : null;
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>This list could not be loaded</AlertTitle>
      <AlertDescription>
        <p>{error instanceof Error ? error.message : 'Something went wrong.'}</p>
        {apiError?.correlationId ? (
          <p className="text-xs">
            Reference <code className="font-mono">{apiError.correlationId}</code>
          </p>
        ) : null}
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-1">
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
