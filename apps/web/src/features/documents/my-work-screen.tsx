'use client';

import type { KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCheck, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/dts/empty-state';
import { ListShell } from '@/components/dts/list-shell';
import { CardsSkeleton } from '@/components/dts/skeletons';
import { PageHeader } from '@/components/dts/page-header';
import { PriorityLabel, StatusBadge, documentTypeLabel } from '@/components/dts/status-badge';
import { cn } from '@/lib/utils';
import { dueLabel, isPastDue } from './due-date';
import { useAssignedDocuments, type DocumentListItem } from './queries';

/**
 * The documents assigned to the signed-in user, as a list of rows to work through.
 *
 * `GET /documents/assigned` returns the whole queue rather than a page of it, and deliberately so:
 * a personal work queue that needs paging is a queue nobody is working. The states and the footer
 * are still the shared {@link ListShell}, because the four states — loading, empty, error, rows —
 * are the same four, and a second implementation would answer them slightly differently.
 *
 * Civic Ledger draws this queue as rows rather than as a table, and without the card/table/line
 * choice the registry keeps: every row here is something to act on, so each one carries its due
 * date and an Open button, which a table cell or a single line has no room for.
 */
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

      <ListShell
        // The endpoint returns the whole queue, so the pager reports one page of everything
        // rather than pretending to a server-side window that does not exist.
        total={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        onPageChange={() => undefined}
        rowCount={rows.length}
        isLoading={queue.isPending}
        isFetching={queue.isFetching}
        error={queue.error}
        onRetry={() => void queue.refetch()}
        framed={false}
      >
        {(state) => {
          if (state === 'loading') return <CardsSkeleton count={4} />;
          if (state === 'empty')
            return (
              <EmptyState
                icon={CheckCheck}
                title="Nothing is assigned to you"
                description="When a colleague assigns you a document, it appears here and in your notifications."
              />
            );
          return (
            <ul aria-label="Documents assigned to you" className="space-y-3">
              {rows.map((row) => (
                <WorkRow
                  key={row.id}
                  row={row}
                  onOpen={() => router.push(`/documents/${row.id}`)}
                />
              ))}
            </ul>
          );
        }}
      </ListShell>
    </>
  );
}

/** A released or archived document is closed: a missed date on it is history, not a warning. */
const isOpen = (row: DocumentListItem) => row.status !== 'RELEASED' && row.status !== 'ARCHIVED';

/**
 * One assigned document. The whole row opens it for a pointer, as the old table row did; the
 * title link and the Open button are the keyboard's way in, so the row itself is not a tab stop.
 */
function WorkRow({ row, onOpen }: Readonly<{ row: DocumentListItem; onOpen: () => void }>) {
  const overdue = row.dueAt !== null && isOpen(row) && isPastDue(row.dueAt);
  const due = dueLabel(row.dueAt);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  const activate = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget || event.key !== 'Enter') return;
    onOpen();
  };

  return (
    <li
      data-slot="work-row"
      onClick={onOpen}
      onKeyDown={activate}
      className={cn(
        'flex cursor-pointer flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border bg-card p-5 transition-colors hover:bg-accent',
        overdue ? 'border-destructive' : 'border-border',
      )}
    >
      <div className="min-w-0 flex-[1_1_320px] space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={row.status} />
          <PriorityLabel priority={row.priority} />
          <span className="text-xs text-muted-foreground">
            <span className="tracking-number">{row.trackingNumber}</span>
            {` · ${documentTypeLabel(row.type)} · ${row.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}`}
          </span>
        </div>
        <p className="flex items-start gap-1.5">
          <Link
            href={`/documents/${row.id}`}
            onClick={stop}
            className="line-clamp-2 text-[17px] font-semibold text-foreground hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {row.title}
          </Link>
          {row.confidential ? (
            <Lock
              className="mt-1.5 size-3.5 shrink-0 text-muted-foreground"
              aria-label="Confidential"
            />
          ) : null}
        </p>
      </div>

      <div className="ml-auto flex items-center gap-4">
        {row.dueAt === null ? (
          <span className="text-sm text-muted-foreground">No target date</span>
        ) : (
          <span
            className={cn(
              'text-right text-sm tabular-nums',
              overdue ? 'font-semibold text-destructive' : 'text-muted-foreground',
            )}
          >
            <time dateTime={row.dueAt} className="block">
              {new Date(row.dueAt).toLocaleDateString()}
            </time>
            {due === null ? null : <span className="block text-xs">{due}</span>}
          </span>
        )}
        <Button asChild>
          <Link href={`/documents/${row.id}`} onClick={stop}>
            Open
          </Link>
        </Button>
      </div>
    </li>
  );
}
