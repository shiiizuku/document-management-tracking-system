'use client';

import type { ComponentProps } from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, FileX, Lock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/dts/empty-state';
import { DetailSkeleton } from '@/components/dts/skeletons';
import { PriorityLabel, StatusBadge, documentTypeLabel } from '@/components/dts/status-badge';
import { AttachmentsSection } from '@/features/attachments/attachments-section';
import { useDivisions } from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { dueLabel, isPastDue } from './due-date';
import { workflowActionLabel } from './action-labels';
import { DeleteDocumentDialog } from './delete-document-dialog';
import { DocumentActions } from './document-actions';
import { MetadataDialog } from './metadata-dialog';
import { ReferencesSection } from './references-section';
import { ReleaseCarrierDialog } from './release-carrier-dialog';
import { RouteDialog } from './route-dialog';
import { RoutingSlipDialog } from './routing-slip-dialog';
import { currentCustody, presentedStatus, useDocument, type DocumentDetail } from './queries';

/** A released or archived document is a closed record: its files no longer change. */
const isClosed = (document: DocumentDetail) =>
  document.status === 'RELEASED' || document.status === 'ARCHIVED';

/**
 * One document, in full: what it is, what may be done to it, its files, and everything that has
 * happened to it.
 *
 * Two columns since decision 174: the record itself scrolls on the left, while the things you act
 * from — its status, where it is, the available actions and its history — stay in a rail on the
 * right. The previous single column put the timeline below the attachments, which meant scrolling
 * past the document to find out where it had been and scrolling back to do anything about it.
 *
 * The rail is **second in the DOM**, so the narrow layout, where the grid collapses, gives a
 * reader the document before its history rather than the other way round.
 *
 * Each group sits in its own {@link Panel}. Hairline rules alone left one long undifferentiated
 * column, where the eye had no edge to find the attachments or the timeline by.
 */
export function DocumentDetailScreen({ documentId }: Readonly<{ documentId: string }>) {
  const document = useDocument(documentId);
  const { can } = useSession();

  if (document.isPending) {
    return (
      <div className="max-w-5xl">
        <DetailSkeleton />
      </div>
    );
  }

  if (document.error !== null) return <DetailError error={document.error} />;
  if (!document.data) return null;

  const detail = document.data;
  const closed = isClosed(detail);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <div className="min-w-0 space-y-4">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 text-muted-foreground">
            <Link href="/documents">
              <ArrowLeft />
              Registry
            </Link>
          </Button>

          <Panel>
            <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1">
                <p className="eyebrow">
                  {detail.trackingNumber} · {documentTypeLabel(detail.type)} ·{' '}
                  {detail.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}
                </p>
                <h1 className="mt-2 flex items-start gap-2 font-display text-[2.5rem] leading-[1.1] font-normal text-foreground">
                  <span className="min-w-0">{detail.title}</span>
                  {detail.confidential ? (
                    <Lock
                      className="mt-4 size-5 shrink-0 text-muted-foreground"
                      aria-label="Confidential"
                    />
                  ) : null}
                </h1>
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={presentedStatus(detail)} />
                {detail.priority === 'URGENT' ? <PriorityLabel priority="URGENT" /> : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/*
                  Both editing controls are gated on DOCUMENT_EDIT — and hidden on a closed record,
                  where the server refuses them anyway. The routing slip is not: a released document
                  is exactly the one whose printable dossier people still need.
                */}
              {can('DOCUMENT_EDIT') && !closed ? <RouteDialog document={detail} /> : null}
              {can('DOCUMENT_EDIT') && !closed ? <MetadataDialog document={detail} /> : null}
              <RoutingSlipDialog document={detail} />
              {can('DOCUMENT_DELETE') ? <DeleteDocumentDialog document={detail} /> : null}
              {/* Urgent is already a pill beside the status; the quieter priorities sit here. */}
              {detail.priority === 'URGENT' ? null : (
                <span className="ml-auto">
                  <PriorityLabel priority={detail.priority} />
                </span>
              )}
            </div>
          </Panel>
        </div>

        <Panel>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <Field label="Sender" value={detail.sender} />
            <Field label="Company / agency" value={detail.company} />
            <ReferenceNumberField document={detail} />
            <Field label="Email address" value={detail.email} />
            <Field label="Registered" value={new Date(detail.createdAt).toLocaleDateString()} />
            <DueField document={detail} />
            {detail.releaseMethod === null ? null : (
              <Field label="Released by" value={detail.releaseMethod.label} />
            )}
            {/* Asked only of a mailed release. A blank one predates carriers (migration 0013) and
                says so rather than showing a dash, because "not recorded" is the fact. */}
            {detail.releaseMethod?.requiresCarrier === true ? (
              <div>
                <dt className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
                  Carrier
                </dt>
                <dd className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm text-foreground">
                  {detail.releaseMethod.carrier?.label ?? (
                    <span className="text-muted-foreground">Not recorded</span>
                  )}
                  {detail.releaseMethod.carrier === null && can('DOCUMENT_RELEASE_CORRECT') ? (
                    <ReleaseCarrierDialog document={detail} />
                  ) : null}
                </dd>
              </div>
            ) : null}
            {detail.releaseMethod?.trackingReference == null ? null : (
              <Field label="Tracking reference" value={detail.releaseMethod.trackingReference} />
            )}
          </dl>

          {detail.description === null || detail.description === '' ? null : (
            <>
              <Separator />
              <div>
                <h3 className="text-xs tracking-wide text-muted-foreground uppercase">
                  Description
                </h3>
                <p className="mt-0.5 text-sm whitespace-pre-line text-foreground">
                  {detail.description}
                </p>
              </div>
            </>
          )}
        </Panel>

        {/* Before the attachments, and in the ordinary flow of the page: decision 178 freezes the
            reference set at release, so linking has to be reachable well before Prepare Release. */}
        {/* `empty:hidden`: the section renders nothing on an incoming document with no replies,
            and an empty card would be a box around nothing. */}
        <Panel className="empty:hidden">
          <ReferencesSection document={detail} canEdit={can('DOCUMENT_EDIT') && !closed} />
        </Panel>

        <Panel>
          <AttachmentsSection documentId={detail.id} canUpload={can('DOCUMENT_EDIT') && !closed} />
        </Panel>

        <YourMoveBar document={detail} />
      </div>

      <DetailRail document={detail} />
    </div>
  );
}

/**
 * The sticky rail: where the document stands, what can be done to it, and how it got here.
 *
 * `top-8` is the `py-8` the main region gives every page: at `lg`, where the rail is sticky, the shell
 * has no topbar (Civic Ledger moved everything into the sidebar), so there is nothing above it. The shell scrolls the window — there is no inner overflow container — so
 * getting this wrong produces a rail that slides under a header it is supposed to sit below, which
 * is the usual failure of this pattern.
 *
 * The height is capped at the same arithmetic so the column can be a flex box whose last child
 * takes what is left. That is what sizes the timeline's scroll box: it is whatever remains after
 * the status block and the actions, rather than a guessed number that is wrong the moment a
 * document has four allowed actions instead of one.
 */
function DetailRail({ document }: Readonly<{ document: DocumentDetail }>) {
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)]">
      <Panel className="shrink-0">
        <LocationBlock document={document} />

        {/* With actions available they are in the "Your move" bar under the record; the rail only
            says so when there are none, so the absence of a bar is never unexplained. */}
        {document.allowedActions.length === 0 ? (
          <>
            <Separator />
            <section className="space-y-2">
              <h2 className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
                Available actions
              </h2>
              <DocumentActions document={document} />
            </section>
          </>
        ) : null}
      </Panel>

      {/* `min-h-0` lets the panel shrink below its content, which is what hands the timeline's
          own list the overflow instead of the rail. */}
      <Panel className="min-h-0">
        <Timeline document={document} />
      </Panel>
    </aside>
  );
}

/**
 * The "Your move" bar: what this user can do next, pinned to the bottom of the record column.
 *
 * The buttons are `DocumentActions`, so the bar offers exactly the server's `allowedActions` and
 * runs them through the same runner as the palette. The sentence names the first of them —
 * lower-cased from its label, so it reads as a sentence — and the bar does not render at all when
 * there is nothing to do, rather than showing an empty strip.
 *
 * `sticky bottom-0` inside the content column: it stays in view while the record scrolls under it,
 * and ends where the column ends, so it never covers the rail.
 */
function YourMoveBar({ document }: Readonly<{ document: DocumentDetail }>) {
  const [first, ...rest] = document.allowedActions;
  if (first === undefined) return null;

  return (
    <section
      aria-label="Your move"
      className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border-t-2 border-move-bar-rule bg-move-bar px-6 py-3.5 text-move-bar-foreground shadow-[0_-8px_24px_rgb(0_0_0/0.08)]"
    >
      <p className="min-w-0 flex-1 text-[15px]">
        <span className="font-bold">Your move:</span> {workflowActionLabel(first).toLowerCase()}
        {rest.length === 0
          ? '.'
          : `, or ${rest.length === 1 ? 'one other action' : `${rest.length} other actions`}.`}
      </p>
      <DocumentActions document={document} placement="bar" />
    </section>
  );
}

/**
 * One group of the detail view, on a card surface.
 */
function Panel({ className, ...props }: ComponentProps<'div'>) {
  return <Card className={cn('px-6', className)} {...props} />;
}

/**
 * Where the document physically is. (Its status is in the page header, beside the title.)
 *
 * The location is read off the routes, never off `divisionId`: forwarding is non-destructive
 * (ADR-0005), so that column records where the document was *registered* and stops moving after
 * the first hop. Decision 177 — a document's location is its most recent lead hop — is the rule
 * `currentCustody` expresses, and the registry filter and the dashboard chart resolve the same way.
 */
function LocationBlock({ document }: Readonly<{ document: DocumentDetail }>) {
  const divisions = useDivisions();
  const custody = currentCustody(document);
  const name = divisions.data?.find((division) => division.id === custody.divisionId)?.name;

  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
          Currently with
        </h2>
        <p className="mt-0.5 text-sm text-foreground">{name ?? '—'}</p>
      </div>
    </section>
  );
}

/**
 * The reference number, which is two different fields wearing one column (decisions 168, 169).
 *
 * On an outgoing document it is the office's own `ORD-2026-00014`, allocated from
 * `reference_counters` inside the create transaction; on an incoming one it is whatever the
 * sending office printed on their letter. Labelling both "External reference" was wrong in both
 * directions — the outgoing one is not external, and the incoming one is not ours.
 */
function ReferenceNumberField({ document }: Readonly<{ document: DocumentDetail }>) {
  return (
    <Field
      label={document.direction === 'OUTGOING' ? 'Reference number' : "Sender's reference"}
      value={document.referenceNumber}
    />
  );
}

/**
 * The target date, and how far from it this document is (policy register P-04).
 *
 * Counted in whole elapsed calendar days — no working hours, no holidays — which is the whole of
 * the agreed rule. Overdue is only called out while the document is still live: a released or
 * archived record that missed its date is history, not a thing anyone can still act on, and
 * colouring it red forever would train people to ignore the colour.
 */
function DueField({ document }: Readonly<{ document: DocumentDetail }>) {
  if (document.dueAt === null) return <Field label="Target date" value={null} />;

  const label = dueLabel(document.dueAt);
  const overdue = isPastDue(document.dueAt) && !isClosed(document);

  return (
    <div>
      <dt className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
        Target date
      </dt>
      <dd className="mt-0.5 text-sm text-foreground">
        {new Date(document.dueAt).toLocaleDateString()}
        {label === null ? null : (
          <span
            className={cn(
              'ml-2 text-xs',
              overdue ? 'font-semibold text-destructive' : 'text-muted-foreground',
            )}
          >
            {label}
          </span>
        )}
      </dd>
    </div>
  );
}

function Field({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <div>
      <dt className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-foreground first-letter:uppercase">{value ?? '—'}</dd>
    </div>
  );
}

interface TimelineRow {
  key: string;
  at: string;
  title: string;
  detail: string | null;
  transition: string | null;
  /** A for-information copy. Marked as such, and never drawn as custody (decision 160). */
  copy?: boolean;
}

/**
 * Builds the merged history. Exported for its own test: the mapping from route rows to readable
 * hops is the part of this screen with rules in it, and asserting it through a rendered rail would
 * test the layout instead.
 *
 * Every route row becomes one entry for the forward itself and, where the recipient has taken
 * custody, a second one for the acceptance — the pair ADR-0005 moved onto the route row so the
 * slip could print both times. A hop with no `acceptedAt` yields only the forward, which is what
 * makes the document pending at that hop.
 */
export function timelineRows(
  document: DocumentDetail,
  divisionName: (id: string) => string,
): TimelineRow[] {
  const events: TimelineRow[] = document.timeline.map((event) => ({
    key: event.id,
    at: event.occurredAt,
    title: workflowActionLabel(event.action),
    detail: event.remarks,
    transition:
      event.fromStatus === null
        ? null
        : `${event.fromStatus.replaceAll('_', ' ')} → ${event.toStatus.replaceAll('_', ' ')}`,
  }));

  const hops: TimelineRow[] = document.routes.flatMap((route) => {
    const to = divisionName(route.toDivisionId);
    const forward: TimelineRow = route.forInformation
      ? {
          key: route.id,
          at: route.createdAt,
          title: `Copied to ${to} for information`,
          detail: route.remarks,
          transition: null,
          copy: true,
        }
      : {
          key: route.id,
          at: route.createdAt,
          title: `Forwarded to ${to}`,
          detail: route.remarks,
          transition: null,
        };

    if (route.acceptedAt === null) return [forward];
    // A for-information recipient never takes custody, so a stamp on its row is an acknowledgement
    // that it read the copy — drawn as a copy, not as custody (decision 160).
    if (route.forInformation)
      return [
        forward,
        {
          key: `${route.id}:acknowledged`,
          at: route.acceptedAt,
          title: `Acknowledged by ${to}`,
          detail: null,
          transition: null,
          copy: true,
        },
      ];
    return [
      forward,
      {
        key: `${route.id}:accepted`,
        at: route.acceptedAt,
        title: `Accepted by ${to}`,
        detail: null,
        transition: null,
      },
    ];
  });

  return [...events, ...hops].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * Everything that has happened to this document, oldest first, scrolling inside the rail.
 *
 * Workflow events and routing handoffs are merged into one list: they are the same thing to a user
 * asking "where has this been", and two separate lists would make them reconstruct the order
 * themselves.
 *
 * It used to flatten every route row to the string "Forwarded to another division" and throw away
 * `acceptedAt`, `forInformation` and both division ids — which is to say the screen read none of
 * what non-destructive routing had been recording. Division names resolve through `useDivisions`,
 * readable by any authenticated user; an id that resolves to nothing prints as an em dash rather
 * than as a UUID.
 *
 * The scroll is on the list and not on the heading, so the heading stays put while the history
 * moves under it.
 */
function Timeline({ document }: Readonly<{ document: DocumentDetail }>) {
  const divisions = useDivisions();
  const divisionName = (id: string) =>
    divisions.data?.find((division) => division.id === id)?.name ?? '—';
  const entries = timelineRows(document, divisionName);

  return (
    <section className="flex min-h-0 flex-col gap-2">
      <h2 className="text-xs font-bold tracking-[0.05em] text-foreground-secondary uppercase">
        Timeline
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has happened to this document since it was registered.
        </p>
      ) : (
        <ol className="min-h-0 space-y-3 overflow-y-auto border-l border-border pl-4">
          {entries.map((entry) => (
            <li key={entry.key} className="relative">
              <span
                className={cn(
                  'absolute top-1.5 -left-[1.15rem] size-2 rounded-full',
                  // A copy is not custody, so it does not get the solid dot a hop does.
                  entry.copy ? 'bg-card ring-1 ring-border' : 'bg-primary',
                )}
                aria-hidden
              />
              <p className="text-sm font-medium text-foreground">{entry.title}</p>
              <p className="text-xs text-muted-foreground tabular-nums">
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                {entry.transition === null ? null : (
                  <span className="lowercase"> · {entry.transition}</span>
                )}
              </p>
              {entry.detail === null || entry.detail === '' ? null : (
                <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">
                  {entry.detail}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * A detail page that could not load. A 404 and a 403 are deliberately shown the same way: telling
 * someone a tracking number exists but is not theirs to read is itself a disclosure.
 */
function DetailError({ error }: Readonly<{ error: unknown }>) {
  const apiError = error instanceof ApiError ? error : null;
  const notFound = apiError?.status === 404 || apiError?.isForbidden === true;

  if (notFound) {
    return (
      <EmptyState
        icon={FileX}
        title="This document is not available"
        description="It may have been deleted, or it may be outside the scope your account can read."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href="/documents">Back to the registry</Link>
          </Button>
        }
      />
    );
  }

  return (
    <Alert variant="destructive" className="max-w-xl">
      <AlertCircle />
      <AlertTitle>This document could not be loaded</AlertTitle>
      <AlertDescription>
        <p>{error instanceof Error ? error.message : 'Something went wrong.'}</p>
        {apiError?.correlationId === null || apiError?.correlationId === undefined ? null : (
          <p className="text-xs">
            Reference <code className="font-mono">{apiError.correlationId}</code>
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
