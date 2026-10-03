'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { ListShell } from './list-shell';
import { TableRowsSkeleton } from './skeletons';

export type SortOrder = 'asc' | 'desc';

export interface SortState {
  /** The column id, which is also the field name the server sorts by. */
  field: string;
  order: SortOrder;
}

/**
 * One field of a record: what it is called, how it is drawn, and how it behaves in a column.
 *
 * Shared by all three document list views (decision 173), not just by the table. A card and a
 * single line read the same array the table does — `header` becomes a card's field label and is
 * dropped by the line view, `cell` draws the value in every one of them. That is the whole reason
 * the type lives here rather than inside the table: a card view that grew its own idea of what a
 * document row says would drift from the table within a month.
 */
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
  sort?: SortState | undefined;
  onSortChange?: ((sort: SortState) => void) | undefined;
  onRowClick?: ((row: Row) => void) | undefined;
  /** Marks the row currently shown in a detail panel beside the table. */
  selectedKey?: string | null | undefined;
  isLoading?: boolean | undefined;
  isFetching?: boolean | undefined;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  /** Shown in place of rows when the query succeeded and matched nothing. */
  empty: ReactNode;
}

/**
 * The app's table.
 *
 * Several screens list server-paginated, server-sorted records — the document registry, users,
 * account requests and the audit trail — and each would otherwise carry its own sort-toggle logic
 * and its own idea of what a pending row looks like. Callers supply columns and say which page and
 * sort they want.
 *
 * The four list states and the pager belong to {@link ListShell}, which this composes and which
 * the card and line views compose too. What stays here is the part that is genuinely about tables:
 * a header that remains visible through every state, and an empty state that has to span the
 * columns rather than sit beside them.
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
    <ListShell
      total={total}
      page={page}
      pageSize={pageSize}
      onPageChange={onPageChange}
      rowCount={rows.length}
      isLoading={isLoading}
      isFetching={isFetching}
      error={error}
      onRetry={onRetry}
    >
      {(state) => (
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

          {state === 'loading' ? (
            <TableRowsSkeleton columns={columns.length} />
          ) : (
            <TableBody>
              {state === 'empty' ? (
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
      )}
    </ListShell>
  );
}
