'use client';

import Link from 'next/link';
import { AlertCircle, ArrowLeft, FileX, Loader2, Lock, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { EmptyState } from '@/components/dts/empty-state';
import { DetailSkeleton } from '@/components/dts/skeletons';
import { PriorityLabel, StatusBadge, documentTypeLabel } from '@/components/dts/status-badge';
import { AttachmentsSection } from '@/features/attachments/attachments-section';
import { useSession } from '@/features/session/queries';
import { ApiError } from '@/lib/api';
import { workflowActionLabel } from './action-labels';
import { DeleteDocumentDialog } from './delete-document-dialog';
import { DocumentActions } from './document-actions';
import { MetadataDialog } from './metadata-dialog';
import { RouteDialog } from './route-dialog';
import { useDocument, useRoutingSlip, type DocumentDetail } from './queries';

/** A released or archived document is a closed record: its files no longer change. */
const isClosed = (document: DocumentDetail) =>
  document.status === 'RELEASED' || document.status === 'ARCHIVED';

/**
 * One document, in full: what it is, what may be done to it, its files, and everything that has
 * happened to it.
 *
 * Replaces the side panel the registry used to open. A route of its own means a tracking number
 * can be bookmarked, pasted into an email, and reached with the back button — which is what
 * people actually do with a reference number.
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
    <div className="max-w-5xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2 mb-2 text-muted-foreground">
          <Link href="/documents">
            <ArrowLeft />
            Registry
          </Link>
        </Button>

        <p className="eyebrow">{detail.trackingNumber}</p>
        <h1 className="mt-1 flex items-start gap-2 text-3xl text-foreground">
          <span className="min-w-0">{detail.title}</span>
          {detail.confidential ? (
            <Lock
              className="mt-2 size-4 shrink-0 text-muted-foreground"
              aria-label="Confidential"
            />
          ) : null}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusBadge status={detail.status} />
          <Badge variant="outline">{documentTypeLabel(detail.type)}</Badge>
          <Badge variant="outline">
            {detail.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}
          </Badge>
          <PriorityLabel priority={detail.priority} />
          <div className="ml-auto flex items-center gap-2">
            {/*
              Both editing controls are gated on DOCUMENT_EDIT — and hidden on a closed record,
              where the server refuses them anyway. The routing slip is not: a released document is
              exactly the one whose printable dossier people still need.
            */}
            {can('DOCUMENT_EDIT') && !closed ? <RouteDialog document={detail} /> : null}
            {can('DOCUMENT_EDIT') && !closed ? <MetadataDialog document={detail} /> : null}
            <RoutingSlipButton document={detail} />
            {can('DOCUMENT_DELETE') ? <DeleteDocumentDialog document={detail} /> : null}
          </div>
        </div>
      </div>

      <Separator />

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Field label="Sender" value={detail.sender} />
        <Field label="Company / agency" value={detail.company} />
        <Field label="External reference" value={detail.referenceNumber} />
        <Field label="Registered" value={new Date(detail.createdAt).toLocaleDateString()} />
        {detail.releaseMethod === null ? null : (
          <Field
            label="Released by"
            value={detail.releaseMethod.replaceAll('_', ' ').toLowerCase()}
          />
        )}
      </dl>

      {detail.description === null || detail.description === '' ? null : (
        <div>
          <h3 className="text-sm font-semibold text-foreground">Description</h3>
          <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
            {detail.description}
          </p>
        </div>
      )}

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Available actions</h3>
        <DocumentActions document={detail} />
      </section>

      <Separator />

      <AttachmentsSection documentId={detail.id} canUpload={can('DOCUMENT_EDIT') && !closed} />

      <Separator />

      <Timeline document={detail} />
    </div>
  );
}

/**
 * Downloads the printable routing slip.
 *
 * Offered to anyone who can read the document, with no capability of its own: the slip contains
 * nothing the page above it does not already show, and it is the artefact that travels stapled to
 * the physical document. The export is still audited server-side, because a copy leaving the system
 * is a different event from reading it on screen.
 */
function RoutingSlipButton({ document }: Readonly<{ document: DocumentDetail }>) {
  const slip = useRoutingSlip();

  const onClick = () =>
    slip.mutate(
      { id: document.id, trackingNumber: document.trackingNumber },
      {
        onError: (error) =>
          toast.error('Could not produce the routing slip', {
            description: error instanceof Error ? error.message : 'Please try again.',
          }),
      },
    );

  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick} disabled={slip.isPending}>
      {slip.isPending ? <Loader2 className="animate-spin" /> : <Printer />}
      Routing slip
    </Button>
  );
}

function Field({ label, value }: Readonly<{ label: string; value: string | null }>) {
  return (
    <div>
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground first-letter:uppercase">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * Everything that has happened to this document, oldest first.
 *
 * Workflow events and routing handoffs are merged into one list: they are the same thing to a
 * user asking "where has this been", and two separate lists would make them reconstruct the order
 * themselves.
 */
function Timeline({ document }: Readonly<{ document: DocumentDetail }>) {
  const entries = [
    ...document.timeline.map((event) => ({
      key: event.id,
      at: event.occurredAt,
      title: workflowActionLabel(event.action),
      detail: event.remarks,
      transition:
        event.fromStatus === null
          ? null
          : `${event.fromStatus.replaceAll('_', ' ')} → ${event.toStatus.replaceAll('_', ' ')}`,
    })),
    ...document.routes.map((route) => ({
      key: route.id,
      at: route.createdAt,
      title: 'Forwarded to another division',
      detail: route.remarks,
      transition: null,
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">Timeline</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has happened to this document since it was registered.
        </p>
      ) : (
        <ol className="space-y-4 border-l border-border pl-5">
          {entries.map((entry) => (
            <li key={entry.key} className="relative">
              <span
                className="absolute top-1.5 -left-[1.4rem] size-2 rounded-full bg-primary"
                aria-hidden
              />
              <p className="text-sm font-medium text-foreground">{entry.title}</p>
              <p className="text-xs text-muted-foreground">
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString()}</time>
                {entry.transition === null ? null : (
                  <span className="lowercase"> · {entry.transition}</span>
                )}
              </p>
              {entry.detail === null || entry.detail === '' ? null : (
                <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
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
