'use client';

import { LayoutGrid, List, Rows3 } from 'lucide-react';
import type { DataTableColumn, SortState } from '@/components/dts/data-table';
import { DataTable } from '@/components/dts/data-table';
import { DocumentCards, DocumentLines } from '@/components/dts/list-views';
import { cn } from '@/lib/utils';
import { LIST_VIEWS, type ListView } from './list-view';
import type { DocumentListItem } from './queries';

/**
 * A document list, in whichever of the three shapes the reader chose (decision 173), and the
 * control that chooses.
 *
 * One component rather than a `switch` on each of the two screens, so the registry and My work
 * cannot end up offering different views, or offering the control and ignoring it. Both hand over
 * the same thing they handed `DataTable` before — a column array, a page of rows, and what to do
 * when one is clicked.
 *
 * Scoped to document lists, and only those. The audit, users, organization and deleted-document
 * tables are not document lists: they answer different questions, their columns are not this
 * field set, and a preference that silently reshaped them would be a different feature.
 */

const VIEW_ICONS: Record<ListView, typeof LayoutGrid> = {
  card: LayoutGrid,
  table: Rows3,
  line: List,
};

export function ListViewControl({
  view,
  onChange,
  className,
}: Readonly<{ view: ListView; onChange: (next: ListView) => void; className?: string }>) {
  return (
    <div
      role="radiogroup"
      aria-label="List view"
      className={cn('inline-flex rounded-lg border border-border bg-card p-0.5', className)}
    >
      {LIST_VIEWS.map((option) => {
        const Icon = VIEW_ICONS[option.id];
        const selected = view === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            title={option.note}
            onClick={() => onChange(option.id)}
            className={cn(
              'md3-state-layer inline-flex items-center gap-1.5 rounded-md3-sm px-2.5 py-1 text-label-medium outline-none focus-visible:ring-2 focus-visible:ring-ring',
              selected
                ? 'bg-secondary text-secondary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export interface DocumentListProps {
  view: ListView;
  caption: string;
  columns: readonly DataTableColumn<DocumentListItem>[];
  rows: readonly DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Only the table can sort, so both are optional and the other two views ignore them. */
  sort?: SortState | undefined;
  onSortChange?: ((sort: SortState) => void) | undefined;
  onRowClick?: ((row: DocumentListItem) => void) | undefined;
  isLoading?: boolean | undefined;
  isFetching?: boolean | undefined;
  error?: unknown;
  onRetry?: (() => void) | undefined;
  empty: React.ReactNode;
}

export function DocumentList({ view, columns, ...props }: DocumentListProps) {
  const rowKey = (row: DocumentListItem) => row.id;

  if (view === 'card') return <DocumentCards {...props} columns={columns} rowKey={rowKey} />;
  if (view === 'line') return <DocumentLines {...props} columns={columns} rowKey={rowKey} />;
  return <DataTable<DocumentListItem> {...props} columns={columns} rowKey={rowKey} />;
}
