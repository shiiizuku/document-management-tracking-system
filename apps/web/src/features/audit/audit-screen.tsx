'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ScrollText, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { DataTable, type DataTableColumn } from '@/components/dts/data-table';
import { EmptyState } from '@/components/dts/empty-state';
import { FilterBar } from '@/components/dts/filter-bar';
import { PageHeader } from '@/components/dts/page-header';
import { DEFAULT_USER_FILTERS, useUsers } from '@/features/admin/queries';
import { useSession } from '@/features/session/queries';
import {
  AUDIT_ACTIONS,
  AUDIT_PAGE_SIZE,
  auditActionLabel,
  useAuditEvents,
  type AuditEvent,
} from './queries';
import {
  auditFiltersToParams,
  hasActiveAuditFilters,
  parseAuditFilters,
  parseAuditPage,
} from './url-state';

/**
 * The audit trail viewer.
 *
 * Its job is to answer "who did what, when" without the reader having to know how any of it is
 * stored. Three things follow from that, and they are the only decisions in this file:
 *
 * Actor ids become names. The trail stores a UUID, deliberately — it survives the account being
 * renamed or deactivated — so the viewer joins it against the directory for display and falls back
 * to the id when the name is not available. The id stays visible in the row detail, because it is
 * the thing that is actually recorded.
 *
 * Filters live in the URL, so a finding can be sent to someone as a link.
 *
 * And every row opens. The columns carry the four facts that let an auditor scan; the structured
 * `summary`, the source address and the correlation ID are what they need once they have found the
 * row, and crowding them into the table would make the scan impossible.
 */
export function AuditScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useSession();
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const filters = parseAuditFilters(searchParams);
  const page = parseAuditPage(searchParams);
  const events = useAuditEvents(filters, page);
  /*
   * The detail panel is not modal, so the page or the filters can change under it. It shows the
   * selection only while that event is among the rows on screen: an auditor must never read the
   * detail of a row the current filters exclude. Derived rather than cleared on navigation, so going
   * back to the page that holds the event brings its detail back.
   */
  const shown =
    selected !== null && (events.data?.items ?? []).some((event) => event.id === selected.id)
      ? selected
      : null;

  // Only for the names and the actor dropdown. Requested at all only when this user may read the
  // directory: the trail is readable by a capability the user list is not.
  const directory = useUsers(DEFAULT_USER_FILTERS, can('USER_MANAGE'));
  const nameById = new Map((directory.data ?? []).map((user) => [user.id, user.displayName]));

  const navigate = (nextFilters: typeof filters, nextPage: number) => {
    const query = auditFiltersToParams(nextFilters, nextPage);
    router.push(query === '' ? '/audit' : `/audit?${query}`, { scroll: false });
  };

  // Any change to what is matched returns to page one: offset 400 of the old result set is rarely
  // a meaningful place in the new one.
  const applyFilters = (patch: Partial<typeof filters>) => navigate({ ...filters, ...patch }, 1);

  const columns: readonly DataTableColumn<AuditEvent>[] = [
    {
      id: 'occurredAt',
      header: 'When',
      className: 'whitespace-nowrap',
      cell: (row) => (
        <time dateTime={row.occurredAt} className="text-sm text-muted-foreground tabular-nums">
          {new Date(row.occurredAt).toLocaleString()}
        </time>
      ),
    },
    {
      id: 'actor',
      header: 'Actor',
      cell: (row) => (
        <span className="text-sm text-foreground">{actorName(row.actorId, nameById)}</span>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      cell: (row) => (
        <span className="text-sm font-medium text-foreground first-letter:uppercase">
          {auditActionLabel(row.action)}
        </span>
      ),
    },
    {
      id: 'target',
      header: 'Target',
      className: 'hidden md:table-cell',
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.targetType} <code className="font-mono">{shortId(row.targetId)}</code>
        </span>
      ),
    },
    {
      id: 'outcome',
      header: 'Outcome',
      align: 'end',
      cell: (row) => (
        <Badge variant={row.outcome === 'SUCCESS' ? 'secondary' : 'destructive'}>
          {row.outcome === 'SUCCESS' ? 'Success' : 'Failure'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Evidence"
        title="Audit trail"
        count={events.data?.total}
        description="Every recorded action, append-only. Select a row for its full detail."
      />

      <FilterBar
        selects={[
          {
            id: 'user',
            label: 'Actor',
            anyLabel: 'Anyone',
            options: (directory.data ?? []).map((user) => ({
              value: user.id,
              label: user.displayName,
            })),
          },
          {
            id: 'action',
            label: 'Action',
            anyLabel: 'Any action',
            options: AUDIT_ACTIONS.map((action) => ({
              value: action,
              label: auditActionLabel(action),
            })),
          },
        ]}
        values={{ user: filters.user, action: filters.action }}
        onSelectChange={(id, value) => applyFilters({ [id]: value })}
        // The date range is one chip, not two: it is one question ("when"), and removing it
        // should widen the window back to everything in a single step.
        extraChips={
          filters.from === '' && filters.to === ''
            ? []
            : [
                {
                  id: 'dates',
                  label: 'Dates',
                  value: dateRangeLabel(filters.from, filters.to),
                  onRemove: () => applyFilters({ from: '', to: '' }),
                },
              ]
        }
        onClear={() => router.push('/audit', { scroll: false })}
        emptyResult={events.data === undefined ? undefined : events.data.total === 0}
      >
        {/*
          Native date inputs rather than a calendar component: the range is typed far more often
          than it is clicked, both bounds are whole days, and the browser's own control is already
          keyboard-accessible and localised.
        */}
        <div className="min-w-0 flex-[1_1_180px]">
          <Label htmlFor="audit-from" className="mb-1.5">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            fieldSize="filter"
            value={filters.from}
            max={filters.to === '' ? undefined : filters.to}
            onChange={(event) => applyFilters({ from: event.target.value })}
          />
        </div>
        <div className="min-w-0 flex-[1_1_180px]">
          <Label htmlFor="audit-to" className="mb-1.5">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            fieldSize="filter"
            value={filters.to}
            min={filters.from === '' ? undefined : filters.from}
            onChange={(event) => applyFilters({ to: event.target.value })}
          />
        </div>
      </FilterBar>

      {/*
        The selected row's detail sits beside the table on a wide screen and wraps below it on a
        narrow one — a flex row rather than a breakpoint, so it moves when the table actually runs
        out of room. It replaced a dialog: an auditor compares a row's detail with its neighbours,
        and a modal hid exactly those.
      */}
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-[999_1_560px]">
          <DataTable<AuditEvent>
            caption="Recorded actions, most recent first"
            columns={columns}
            rows={events.data?.items ?? []}
            rowKey={(row) => row.id}
            total={events.data?.total ?? 0}
            page={page}
            pageSize={AUDIT_PAGE_SIZE}
            onPageChange={(nextPage) => navigate(filters, nextPage)}
            onRowClick={setSelected}
            selectedKey={shown?.id ?? null}
            isLoading={events.isPending}
            isFetching={events.isFetching}
            error={events.error}
            onRetry={() => void events.refetch()}
            empty={
              <EmptyState
                icon={ScrollText}
                title={
                  hasActiveAuditFilters(filters)
                    ? 'No recorded actions match these filters'
                    : 'Nothing has been recorded yet'
                }
                description={
                  hasActiveAuditFilters(filters)
                    ? 'Widen the date range, or clear the filters to see the whole trail.'
                    : 'Actions are recorded as they happen. This list fills itself.'
                }
                className="border-0 bg-transparent"
              />
            }
          />
        </div>
        {shown === null ? null : (
          <EventDetailPanel
            event={shown}
            actorName={actorName(shown.actorId, nameById)}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </>
  );
}

/**
 * One row in full, in a panel beside the table.
 *
 * The `summary` is rendered as formatted JSON rather than as a field list, and that is the honest
 * choice: its keys differ per action, the API's policy is that it holds IDs and enum values only,
 * and a presentation layer that guessed at labels would eventually mislabel evidence.
 *
 * Focus moves to the panel when a row is chosen, so a keyboard user lands on what they opened, and
 * back to nothing in particular on close — the row they came from is still where it was.
 */
function EventDetailPanel({
  event,
  actorName: name,
  onClose,
}: Readonly<{ event: AuditEvent; actorName: string; onClose: () => void }>) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [event.id]);

  return (
    <section
      aria-labelledby="audit-detail-title"
      className="relative min-w-0 flex-[1_1_300px] space-y-4 rounded-2xl border-[1.5px] border-seal bg-card p-5"
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClose}
        aria-label="Close the detail"
        className="absolute top-3 right-3 bg-muted text-muted-foreground"
      >
        <X />
      </Button>
      <div className="pr-12">
        <p className="eyebrow">Recorded action</p>
        <h2
          id="audit-detail-title"
          ref={headingRef}
          tabIndex={-1}
          className="mt-1 font-display text-[26px] leading-tight first-letter:uppercase focus:outline-none"
        >
          {auditActionLabel(event.action)}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <Detail label="Actor" value={name} />
        <Detail label="Actor id" value={event.actorId} mono />
        <Detail label="Target" value={`${event.targetType} ${event.targetId}`} mono />
        <Detail label="Outcome" value={event.outcome} />
        <Detail label="Source address" value={event.sourceIp} mono />
        <Detail label="Correlation id" value={event.correlationId} mono />
      </dl>

      <div>
        <h3 className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
          Detail
        </h3>
        <pre className="mt-1 overflow-x-auto rounded-xl border border-border bg-muted p-3 font-mono text-xs">
          {JSON.stringify(event.summary, null, 2)}
        </pre>
      </div>
    </section>
  );
}
function Detail({
  label,
  value,
  mono = false,
}: Readonly<{ label: string; value: string | null; mono?: boolean }>) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
        {label}
      </dt>
      <dd className={`mt-0.5 truncate text-foreground${mono ? ' font-mono text-xs' : ''}`}>
        {value === null || value === '' ? '—' : value}
      </dd>
    </div>
  );
}

/**
 * Who acted. A `null` actor is not missing data — it is the recorded fact that the action had no
 * authenticated actor, which is what a failed sign-in looks like, so it is named as such.
 */
const actorName = (actorId: string | null, nameById: Map<string, string>): string => {
  if (actorId === null) return 'Unauthenticated';
  return nameById.get(actorId) ?? actorId;
};

/** The leading segment of a UUID — enough to recognise a row, short enough to scan a column of. */
const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

/** "Oct 1 – Oct 7, 2026", or an open-ended "From Oct 1, 2026" / "Until Oct 7, 2026". */
const dateRangeLabel = (from: string, to: string): string => {
  const format = (day: string, withYear: boolean) =>
    new Date(`${day}T00:00:00.000Z`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  if (from !== '' && to !== '') {
    const sameYear = from.slice(0, 4) === to.slice(0, 4);
    return `${format(from, !sameYear)} – ${format(to, true)}`;
  }
  return from !== '' ? `From ${format(from, true)}` : `Until ${format(to, true)}`;
};
