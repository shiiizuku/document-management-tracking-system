'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { AlertCircle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { TableRowsSkeleton } from './skeletons';

export type SortOrder = 'asc' | 'desc';

export interface SortState {
  /** The column id, which is also the field name the server sorts by. */
  field: string;
  order: SortOrder;
}

export interface DataTableColumn<Row> {
  /** Stable identity, and the sort field sent to the server when `sortable` is set. */
  id: string;
  header: ReactNode;
  cell: (row: Row) => ReactNode;
  /** Opt in to a clickable header. Sorting always happens on the server, never in this component. */
  sortable?: boolean;
  align?: 'start' | 'end';
  /** Applied to both the header and body cells, for widths and responsive hiding. */
  className?: string;
}

export interface DataTableProps<Row> {
  /** Describes the table for screen readers; never rendered visually. */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Total matching rows on the server — not `rows.length`, which is one page of them. */
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: Row) => void;
  /** Marks the row currently shown in a detail panel beside the table. */
  selectedKey?: string | null;
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown in place of rows when the query succeeded and matched nothing. */
  empty: ReactNode;
}

/**
 * The app's one table.
 *
 * Four screens list server-paginated, server-sorted records — the document registry, users,
 * account requests and the audit trail — and each of them would otherwise carry its own copy of
 * the same four states (loading, empty, error, rows), the same sort-toggle logic and the same
 * pager arithmetic. This owns all of it. Callers supply columns and say which page and sort they
 * want; they never compute a page count or decide what a pending row looks like.
 *
 * Paging and sorting are *reported*, not performed: this component never slices or reorders
 * `rows`. The server already applied the scope rules that decide which records exist, so sorting
 * a page in the browser would reorder a window rather than the result set, and would silently
 * disagree with the total beside the heading.
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  sort,
  onSortChange,
  onRowClick,
  selectedKey,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  empty,
}: DataTableProps<Row>) {
  // At least one page, so "Page 1 of 1" reads correctly for an empty result set.
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, total);

  if (error !== undefined && error !== null) {
    return <DataTableError error={error} onRetry={onRetry} />;
  }

  const toggleSort = (column: DataTableColumn<Row>) => {
    if (!onSortChange) return;
    // A first click on a new column sorts descending: every sortable column here is a date or a
    // rank, where the interesting end is the top.
    const order: SortOrder = sort?.field === column.id && sort.order === 'desc' ? 'asc' : 'desc';
    onSortChange({ field: column.id, order });
  };

  const activateRow = (row: Row) => (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onRowClick?.(row);
  };

  return (
    <div className="space-y-3">
      <div
        className={cn(
          'overflow-x-auto rounded-lg border border-border bg-card transition-opacity',
          // A refetch keeps the current page on screen and dims it rather than replacing it with
          // skeletons: flipping the whole list back to a loading state on every filter change
          // reads as a slower app than one showing briefly stale rows.
          isFetching && !isLoading && 'opacity-60',
        )}
      >
        <Table>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const active = sort?.field === column.id;
                return (
                  <TableHead
                    key={column.id}
                    aria-sort={
                      active && sort ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'
                    }
                    className={cn(column.align === 'end' && 'text-right', column.className)}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column)}
                        className="-mx-2 inline-flex items-center gap-1 rounded px-2 py-1 font-medium hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {column.header}
                        {active && sort ? (
                          sort.order === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden />
                          ) : (
                            <ArrowDown className="size-3.5" aria-hidden />
                          )
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>

          {isLoading ? (
            <TableRowsSkeleton columns={columns.length} />
          ) : (
            <TableBody>
              {rows.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="p-0">
                    {empty}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <TableRow
                      key={key}
                      data-state={selectedKey === key ? 'selected' : undefined}
                      {...(onRowClick
                        ? {
                            onClick: () => onRowClick(row),
                            onKeyDown: activateRow(row),
                            tabIndex: 0,
                            className:
                              'cursor-pointer focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                          }
                        : {})}
                    >
                      {columns.map((column) => (
                        <TableCell
                          key={column.id}
                          className={cn(column.align === 'end' && 'text-right', column.className)}
                        >
                          {column.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          )}
        </Table>
      </div>

      {/* Stays mounted while loading so the footer does not jump as rows arrive. */}
      <nav className="flex items-center justify-between gap-4 text-sm" aria-label="Pagination">
        <p className="text-muted-foreground tabular-nums">
          {total === 0 ? 'No results' : `Showing ${firstOnPage}-${lastOnPage} of ${total}`}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground tabular-nums">
            Page {page} of {pageCount}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight />
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
function DataTableError({
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
