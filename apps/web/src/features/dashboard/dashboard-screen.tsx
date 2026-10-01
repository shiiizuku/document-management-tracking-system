'use client';

import Link from 'next/link';
import { AlertCircle, Clock, FileText, Inbox, LayoutDashboard } from 'lucide-react';
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
import { useSession } from '@/features/session/queries';
import { useDashboardSummary, type DashboardSummary } from './queries';

/**
 * What is on the user's plate, at a glance.
 *
 * Every figure is a link to the list that produced it. A dashboard number nobody can click is a
 * number nobody can check, and these are the same scoped counts the registry reports — so the
 * tile, the bar and the filtered list always agree.
 */
export function DashboardScreen() {
  const summary = useDashboardSummary();
  const { user } = useSession();

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
        eyebrow="Overview"
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
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
  href?: string;
  icon: typeof Inbox;
  emphasis?: boolean;
}>) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
        <Icon className="size-4 text-muted-foreground" aria-hidden />
      </div>
      <p
        className={
          emphasis
            ? 'mt-1 font-serif text-3xl text-destructive tabular-nums'
            : 'mt-1 font-serif text-3xl text-foreground tabular-nums'
        }
      >
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </>
  );

  // Only the tiles whose figure corresponds to a filter the registry can express are links.
  // "Overdue" is not one of them yet, and a link that silently showed something else would be
  // worse than no link.
  return href === undefined ? (
    <article className="rounded-lg border border-border bg-card p-4">{body}</article>
  ) : (
    <Link
      href={href}
      className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {body}
    </Link>
  );
}

/**
 * Where the unaccepted work is sitting.
 *
 * Bars rather than a chart library: there are a handful of divisions, the comparison is one
 * dimensional, and each bar has to be a link to the division's own filtered list.
 */
function PendingByDivision({ summary }: Readonly<{ summary: DashboardSummary | undefined }>) {
  if (summary === undefined) return <PanelSkeleton title="Pending by division" rows={4} />;

  const rows = summary.pendingByDivision;
  const largest = Math.max(1, ...rows.map((row) => row.total));

  return (
    <section className="space-y-3">
      <h2 className="text-lg text-foreground">Pending by division</h2>
      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing is waiting"
          description="No documents in your scope are awaiting acceptance."
          className="py-10"
        />
      ) : (
        <ul className="space-y-2 rounded-lg border border-border bg-card p-4">
          {rows.map((row) => (
            <li key={row.divisionId}>
              <Link
                href={`/documents?status=PENDING&divisionId=${encodeURIComponent(row.divisionId)}`}
                className="group block rounded-md p-1.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate text-foreground">{row.divisionName}</span>
                  <span className="shrink-0 font-medium text-muted-foreground tabular-nums">
                    {row.total}
                  </span>
                </span>
                <span
                  className="mt-1 block h-1.5 overflow-hidden rounded-full bg-secondary"
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
      <h2 className="text-lg text-foreground">Recent activity</h2>
      {summary.recentActivity.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No activity yet"
          description="Workflow actions on documents in your scope appear here."
          className="py-10"
        />
      ) : (
        <ol className="divide-y divide-border rounded-lg border border-border bg-card">
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
                  <span className="text-muted-foreground/70">{entry.trackingNumber}</span>
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
      <h2 className="text-lg text-foreground">{title}</h2>
      <div className="space-y-3 rounded-lg border border-border bg-card p-4" aria-hidden>
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    </section>
  );
}
