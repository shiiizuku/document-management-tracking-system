'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowUpRight, CheckCheck, Lock } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/dts/data-table';
import { EmptyState } from '@/components/dts/empty-state';
import { PageHeader } from '@/components/dts/page-header';
import { PriorityLabel, StatusBadge, documentTypeLabel } from '@/components/dts/status-badge';
import { api } from '@/lib/api';
import type { DocumentListItem } from './queries';

/**
 * The documents assigned to the signed-in user.
 *
 * `GET /documents/assigned` returns the whole queue rather than a page of it, and deliberately so:
 * a personal work queue that needs paging is a queue nobody is working. The table is still the
 * shared one, because the four states — loading, empty, error, rows — are the same four, and a
 * second list component would answer them slightly differently.
 */

const assignedKeys = {
  queue: ['documents', 'assigned'] as const,
};

function useAssignedDocuments() {
  return useQuery({
    queryKey: assignedKeys.queue,
    queryFn: () => api<DocumentListItem[]>('/documents/assigned'),
  });
}

const columns: readonly DataTableColumn<DocumentListItem>[] = [
  {
    id: 'title',
    header: 'Document',
    cell: (row) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{row.title}</span>
          {row.confidential ? (
            <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Confidential" />
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.trackingNumber} · {documentTypeLabel(row.type)}
        </div>
      </div>
    ),
  },
  { id: 'status', header: 'Status', cell: (row) => <StatusBadge status={row.status} /> },
  { id: 'priority', header: 'Priority', cell: (row) => <PriorityLabel priority={row.priority} /> },
  {
    id: 'direction',
    header: 'Direction',
    className: 'hidden md:table-cell',
    cell: (row) => (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        {row.direction === 'INCOMING' ? (
          <ArrowDownLeft className="size-3.5" aria-hidden />
        ) : (
          <ArrowUpRight className="size-3.5" aria-hidden />
        )}
        {row.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}
      </span>
    ),
  },
  {
    id: 'createdAt',
    header: 'Registered',
    align: 'end',
    className: 'hidden sm:table-cell',
    cell: (row) => (
      <time dateTime={row.createdAt} className="text-sm text-muted-foreground tabular-nums">
        {new Date(row.createdAt).toLocaleDateString()}
      </time>
    ),
  },
];

export function MyWorkScreen() {
  const router = useRouter();
  const queue = useAssignedDocuments();
  const rows = queue.data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Assigned to me"
        title="My work"
        count={queue.data?.length}
        description="Documents currently assigned to you. Clearing this queue is what moves them on."
      />

      <DataTable<DocumentListItem>
        caption="Documents assigned to you"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        // The endpoint returns the whole queue, so the pager reports one page of everything
        // rather than pretending to a server-side window that does not exist.
        total={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        onPageChange={() => undefined}
        onRowClick={(row) => router.push(`/documents/${row.id}`)}
        isLoading={queue.isPending}
        isFetching={queue.isFetching}
        error={queue.error}
        onRetry={() => void queue.refetch()}
        empty={
          <EmptyState
            icon={CheckCheck}
            title="Nothing is assigned to you"
            description="When a colleague assigns you a document, it appears here and in your notifications."
            className="border-0 bg-transparent"
          />
        }
      />
    </>
  );
}
