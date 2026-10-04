'use client';

import type { KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import type { DataTableColumn } from './data-table';
import { ListShell } from './list-shell';
import { CardsSkeleton, LinesSkeleton } from './skeletons';

/**
 * The two non-table document list views (decision 173).
 *
 * Both read the **same** `DataTableColumn` array the table does, which is the point: the column
 * definitions on the registry and My work screens are the source of truth for what a document row
 * says, and a card view carrying its own list of fields would answer the same question differently
 * within a month. What differs between the three is layout, not content — a card shows every
 * field under its own label, a line shows them side by side, a table shows them in columns.
 *
 * Neither is sortable. Sorting is driven by clicking a column header, and a view with no headers
 * has nowhere to put the control; the table is the view that sorts, and the segmented control says
 * so in its own description.
 */

interface ListViewProps<Row> {
  /** Describes the list for screen readers; never rendered visually. */
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onRowClick?: ((row: Row) => void) | undefined;
  selectedKey?: string | null | undefined;
  isLoading?: boolean | undefined;
  isFetching?: boolean | undefined;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  empty: React.ReactNode;
}

/**
 * The first column is the record's identity — its title and tracking number on both document
 * lists — so it leads a card and a line rather than appearing as one labelled field among the
 * rest. This is a convention of the column array, held in one place so both views read it the
 * same way.
 */
const splitPrimary = <Row,>(columns: readonly DataTableColumn<Row>[]) => ({
  primary: columns[0],
  rest: columns.slice(1),
});

const activate =
  <Row,>(row: Row, onRowClick: ((row: Row) => void) | undefined) =>
  (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onRowClick?.(row);
  };

/** One panel per document: the identity field, then every other field under its own label. */
export function DocumentCards<Row>({
  caption,
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  onRowClick,
  selectedKey,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  empty,
}: ListViewProps<Row>) {
  const { primary, rest } = splitPrimary(columns);

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
      framed={false}
    >
      {(state) => {
        if (state === 'loading') return <CardsSkeleton />;
        if (state === 'empty') return empty;
        return (
          <ul
            aria-label={caption}
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
            data-testid="document-cards"
          >
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <li key={key}>
                  <article
                    data-slot="document-card"
                    data-state={selectedKey === key ? 'selected' : undefined}
                    {...(onRowClick
                      ? {
                          onClick: () => onRowClick(row),
                          onKeyDown: activate(row, onRowClick),
                          tabIndex: 0,
                          role: 'link',
                        }
                      : {})}
                    className={cn(
                      'h-full rounded-lg border border-border bg-card p-3',
                      'data-[state=selected]:border-primary',
                      onRowClick &&
                        'cursor-pointer hover:border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                    )}
                  >
                    {primary === undefined ? null : primary.cell(row)}
                    {rest.length === 0 ? null : (
                      // One hairline, not a nested card: the fields belong to the panel they are
                      // already inside.
                      <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-2.5">
                        {rest.map((column) => (
                          <div key={column.id} className="min-w-0">
                            <dt className="text-xs text-muted-foreground">{column.header}</dt>
                            <dd className="mt-0.5">{column.cell(row)}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>
        );
      }}
    </ListShell>
  );
}

/**
 * One line per document, at the tightest the field set allows.
 *
 * The labels go, because a line is read by scanning down a position rather than by reading a
 * name, and every field but the identity one is hidden below `sm` — at that width a line and a
 * card would otherwise be the same thing, and the card is the better one.
 */
export function DocumentLines<Row>({
  caption,
  columns,
  rows,
  rowKey,
  total,
  page,
  pageSize,
  onPageChange,
  onRowClick,
  selectedKey,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  empty,
}: ListViewProps<Row>) {
  const { primary, rest } = splitPrimary(columns);

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
      {(state) => {
        if (state === 'loading') return <LinesSkeleton />;
        if (state === 'empty') return empty;
        return (
          <ul aria-label={caption} className="divide-y divide-border" data-testid="document-lines">
            {rows.map((row) => {
              const key = rowKey(row);
              return (
                <li
                  data-slot="document-line"
                  key={key}
                  data-state={selectedKey === key ? 'selected' : undefined}
                  {...(onRowClick
                    ? {
                        onClick: () => onRowClick(row),
                        onKeyDown: activate(row, onRowClick),
                        tabIndex: 0,
                        role: 'link',
                      }
                    : {})}
                  className={cn(
                    'flex items-center gap-3 px-3 py-1.5',
                    'data-[state=selected]:bg-secondary/40',
                    onRowClick &&
                      'cursor-pointer hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    {primary === undefined ? null : primary.cell(row)}
                  </div>
                  {rest.map((column) => (
                    <div
                      key={column.id}
                      className={cn('hidden shrink-0 sm:block', column.className)}
                    >
                      {column.cell(row)}
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        );
      }}
    </ListShell>
  );
}
