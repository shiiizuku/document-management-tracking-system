'use client';

import { useSyncExternalStore } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowRight, Clock, FileText, Inbox, LayoutDashboard } from 'lucide-react';
import type { WorkflowStatus } from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/dts/empty-state';
import { PageHeader } from '@/components/dts/page-header';
import { TilesSkeleton } from '@/components/dts/skeletons';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/dts/status-badge';
import { workflowActionLabel } from '@/features/documents/action-labels';
import { relativeTime } from '@/features/notifications/queries';
import { useAssignedDocuments } from '@/features/documents/queries';
import { useSession } from '@/features/session/queries';
import { cn } from '@/lib/utils';
import { useDashboardSummary, type DashboardSummary } from './queries';

/**
 * What is on the user's plate, at a glance.
 *
 * Every figure is a link to the list that produced it, Overdue included. A dashboard number nobody can click is a
 * number nobody can check, and these are the same scoped counts the registry reports — so the
 * tile, the bar and the filtered list always agree.
 */
/*
 * The calendar day in the viewer's own timezone, read only in the browser.
 *
 * Formatted during server rendering it would be the server's day, which for an office in UTC+8
 * is yesterday for the first eight hours after local midnight — and the hydrated text would then
 * disagree with what the server sent. `getServerSnapshot` returns null, so the server and the
 * hydration pass both print a plain "Today" and the date appears on the client's next render.
 */
const noSubscription = () => () => {};
const localDay = () =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const noDayOnServer = () => null;

export function DashboardScreen() {
  const summary = useDashboardSummary();
  const { user } = useSession();
  const today = useSyncExternalStore(noSubscription, localDay, noDayOnServer);

  if (summary.error !== null) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Dashboard" />
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The dashboard could not be loaded</AlertTitle>
          <AlertDescription>
            <p>
              {summary.error instanceof Error ? summary.error.message : 'Something went wrong.'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => void summary.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const data = summary.data;

  return (
    <>
      <PageHeader
        eyebrow={today === null ? 'Today' : `Today · ${today}`}
        title={user === null ? 'Dashboard' : `Good day, ${user.displayName.split(' ')[0] ?? ''}`}
        description="Everything below counts only what your account is authorized to see."
        actions={
          <Button asChild variant="outline">
            <Link href="/documents">Open the registry</Link>
          </Button>
        }
      />

      {data === undefined ? (
        <TilesSkeleton />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <Tile
            label="Awaiting acceptance"
            value={data.byStatus.PENDING}
            hint="Not yet picked up"
            href="/documents?status=PENDING"
            icon={Inbox}
          />
          <Tile
            label="In progress"
            value={inProgress(data.byStatus)}
            hint="Accepted and moving"
            href="/documents?status=IN_PROCESS"
            icon={FileText}
          />
          <Tile
            label="Overdue"
            value={data.overdue}
            hint="Past their due date"
            href="/documents?overdue=true"
            icon={Clock}
            emphasis={data.overdue > 0}
          />
          <Tile
            label="All documents"
            value={data.total}
            hint="Across your authorized scope"
            href="/documents"
            icon={LayoutDashboard}
          />
        </div>
      )}

      <YourMoveStrip />

      <div className="grid gap-6 lg:grid-cols-2">
        <PendingByDivision summary={data} />
        <RecentActivity summary={data} />
      </div>
    </>
  );
}

/** Everything accepted but not yet finished — the work actually in flight. */
const inProgress = (byStatus: Record<WorkflowStatus, number>): number =>
  byStatus.IN_PROCESS + byStatus.FOR_REVISION + byStatus.FOR_SIGNATURE + byStatus.FOR_RELEASE;

function Tile({
  label,
  value,
  hint,
  href,
  icon: Icon,
  emphasis = false,
}: Readonly<{
  label: string;
  value: number;
  hint: string;
  href: string;
  icon: typeof Inbox;
  emphasis?: boolean;
}>) {
  /*
   * Every tile is a link — Overdue included, now that the registry can filter on the same
   * `documentIsOverdue` predicate the count comes from. A tile whose figure the list could not
   * reproduce would be worse than no link, which is why Overdue waited for that filter.
   *
   * Emphasis is a red border and red figures, never red alone: the label still says "Overdue".
   */
  return (
    <Link
      href={href}
      className={cn(
        'group flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:bg-accent',
        'focus-visible:ring-2 focus-visible:ring-seal focus-visible:ring-offset-[3px] focus-visible:ring-offset-background focus-visible:outline-none',
        emphasis ? 'border-[1.5px] border-destructive' : 'border-border',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            'text-[13px] font-bold tracking-[0.04em] uppercase',
            emphasis ? 'text-destructive' : 'text-foreground-secondary',
          )}
        >
          {label}
        </span>
        <Icon
          className={cn('size-4', emphasis ? 'text-destructive' : 'text-muted-foreground')}
          aria-hidden
        />
      </span>
      <span
        className={cn(
          'mt-2 font-display text-5xl leading-none tabular-nums',
          emphasis ? 'text-destructive' : 'text-foreground',
        )}
      >
        {value.toLocaleString()}
      </span>
      <span className="mt-2 text-sm text-muted-foreground">{hint}</span>
      <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
        View list
        <ArrowRight className="size-3.5" aria-hidden />
      </span>
    </Link>
  );
}

/**
 * The "Your move" strip: how many documents are waiting on this user, and the way to them.
 *
 * The count is the length of the My work queue — the same query, under the same key, that the My
 * work screen reads, so the strip and the screen it links to share one request and one answer. The
 * dashboard summary has no such field, and adding one would be a second definition of "assigned
 * to you" to keep in step with the first. Hidden at zero, and while the queue is loading or failed:
 * a strip saying "0 documents" asks nothing of anyone.
 */
function YourMoveStrip() {
  const queue = useAssignedDocuments();
  const count = Array.isArray(queue.data) ? queue.data.length : 0;
  if (count === 0) return null;

  return (
    <section
      aria-label="Your move"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border-t-2 border-move-bar-rule bg-move-bar px-6 py-4 text-move-bar-foreground"
    >
      <p className="min-w-0 flex-1 text-[15px]">
        <span className="font-bold">Your move:</span>{' '}
        <span className="tabular-nums">{count.toLocaleString()}</span>{' '}
        {count === 1 ? 'document is' : 'documents are'} assigned to you.
      </p>
      <Button
        asChild
        className="bg-move-action font-bold text-move-action-foreground hover:bg-move-action/90"
      >
        <Link href="/my-work">Open my work</Link>
      </Button>
    </section>
  );
}
/**
 * Where the unaccepted work is sitting.
 *
 * Bars rather than a chart library: there are a handful of divisions, the comparison is one
 * dimensional, and each bar has to be a link to the division's own filtered list.
 */
function PendingByDivision({ summary }: Readonly<{ summary: DashboardSummary | undefined }>) {
  if (summary === undefined) return <PanelSkeleton title="En route by division" rows={4} />;

  const rows = summary.pendingByDivision;
  const largest = Math.max(1, ...rows.map((row) => row.total));

  return (
    <section className="space-y-3">
      <h2 className="font-display text-[26px] leading-tight text-foreground">
        En route by division
      </h2>
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing is waiting"
          description="No documents in your scope are awaiting acceptance."
          className="py-10"
        />
      ) : (
        <ul className="space-y-1 rounded-2xl border border-border bg-card p-4">
          {rows.map((row) => (
            <li key={row.divisionId}>
              <Link
                href={`/documents?status=PENDING&divisionId=${encodeURIComponent(row.divisionId)}`}
                className="group block rounded-[10px] px-2 py-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{row.divisionName}</span>
                  <span className="shrink-0 font-semibold text-foreground-secondary tabular-nums">
                    {row.total.toLocaleString()}
                  </span>
                </span>
                <span
                  className="mt-1.5 block h-2 overflow-hidden rounded-full bg-border-subtle"
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((row.total / largest) * 100)}%` }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What has moved lately, newest first, each entry linking to the document it happened to. */
function RecentActivity({ summary }: Readonly<{ summary: DashboardSummary | undefined }>) {
  if (summary === undefined) return <PanelSkeleton title="Recent activity" rows={5} />;

  return (
    <section className="space-y-3">
      <h2 className="font-display text-[26px] leading-tight text-foreground">Recent activity</h2>
      {summary.recentActivity.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No activity yet"
          description="Workflow actions on documents in your scope appear here."
          className="py-10"
        />
      ) : (
        <ol className="divide-y divide-border-subtle rounded-2xl border border-border bg-card">
          {summary.recentActivity.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/documents/${entry.documentId}`}
                className="block px-4 py-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {entry.title}
                  </span>
                  <time
                    dateTime={entry.occurredAt}
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {relativeTime(entry.occurredAt)}
                  </time>
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={entry.toStatus} />
                  {workflowActionLabel(entry.action)} by {entry.actorName}
                  <span className="tracking-number text-muted-foreground">
                    {entry.trackingNumber}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PanelSkeleton({ title, rows }: Readonly<{ title: string; rows: number }>) {
  return (
    <section className="space-y-3">
      <h2 className="font-display text-[26px] leading-tight text-foreground">{title}</h2>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-hidden>
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    </section>
  );
}
