'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Link2, Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/dts/status-badge';
import { InlineFilePane } from '@/components/dts/inline-file-pane';
import {
  attachmentContentPath,
  formatBytes,
  isPreviewable,
  useAttachments,
  type AttachmentVersion,
} from '@/features/attachments/queries';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';
import {
  DOCUMENT_SEARCH_MIN_LENGTH,
  useDocumentSearch,
  useLinkReference,
  useUnlinkReference,
  type DocumentDetail,
  type ReferenceDocumentSummary,
} from './queries';

/**
 * What an outgoing document answers, and what answers an incoming one (decisions 165–167).
 *
 * **Renders exactly what the payload holds.** The lists are short by omission (decision 166): a
 * reference the reader may not read is simply absent, so two readers legitimately see different
 * lengths for the same document. No count from another source, no "1 reference hidden", no
 * placeholder row — all of which would reintroduce the existence oracle the API was written to
 * avoid, and the first two would be a running count of documents the reader cannot see.
 *
 * Linking is offered on the outgoing side only, because the relation is directional, and only
 * while the record is open: decision 178 freezes the set at release, the server already refuses,
 * and this is about not offering a control that cannot work. It is also why the section sits in
 * the ordinary flow of the page rather than behind a release-time step — linking has to be
 * reachable before Prepare Release or there is no moment at which it can happen.
 */
export function ReferencesSection({
  document,
  canEdit,
}: Readonly<{ document: DocumentDetail; canEdit: boolean }>) {
  const outgoing = document.direction === 'OUTGOING';
  const references = outgoing ? document.referencedDocuments : document.replyDocuments;
  const [open, setOpen] = useState<ReferenceDocumentSummary | null>(null);

  // Nothing to say on an incoming document nobody has replied to: an empty "Replies" heading is a
  // statement about documents the reader may not be able to see, and is noise on most records.
  if (!outgoing && references.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Link2 className="size-4 text-muted-foreground" aria-hidden />
          {outgoing ? 'Reference an incoming document' : 'Replies'}
        </h3>
        {outgoing && canEdit ? <AddReference document={document} /> : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {outgoing
          ? 'Link the incoming documents this letter replies to or complies with.'
          : 'The outgoing documents that answer this one.'}
      </p>

      {references.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is linked yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {references.map((reference) => (
            <li key={reference.id} className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => setOpen(reference)}
                className="min-w-0 flex-1 rounded text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="block truncate text-sm font-medium text-foreground">
                  {reference.title}
                </span>
                <span className="block text-xs text-muted-foreground tabular-nums">
                  {reference.trackingNumber}
                </span>
              </button>
              <StatusBadge status={reference.status} />
              {outgoing && canEdit ? (
                <UnlinkButton document={document} reference={reference} />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ReferenceDialog
        reference={open}
        onClose={() => setOpen(null)}
        heading={outgoing ? 'Referenced incoming document' : 'Reply'}
      />
    </section>
  );
}

/**
 * The one message both misses get.
 *
 * A target that does not exist and a target outside the reader's scope arrive as identical 404s
 * (decision 166) and must leave as identical copy, or the UI reintroduces the existence oracle the
 * API was written to avoid.
 */
export const LINK_REFUSAL =
  'That document could not be linked. It may not exist, or it may be outside the scope your account can read.';

const refusalDescription = (error: unknown): string =>
  error instanceof Error && error.message !== '' && !/not found/i.test(error.message)
    ? error.message
    : LINK_REFUSAL;

function UnlinkButton({
  document,
  reference,
}: Readonly<{ document: DocumentDetail; reference: ReferenceDocumentSummary }>) {
  const unlink = useUnlinkReference(document.id);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      disabled={unlink.isPending}
      aria-label={`Remove the reference to ${reference.trackingNumber}`}
      onClick={() =>
        unlink.mutate(reference.id, {
          onError: (error) =>
            toast.error('Could not remove this reference', {
              description: refusalDescription(error),
            }),
        })
      }
    >
      {unlink.isPending ? <Loader2 className="animate-spin" /> : <X />}
    </Button>
  );
}

/**
 * Picks an incoming document to link, over the registry's own search.
 *
 * Incoming documents only, because the relation is outgoing-names-incoming and offering an
 * outgoing one would produce a refusal the user could have been spared. Already-linked documents
 * are filtered out for the same reason — a repeat link is a quiet no-op server-side, so offering
 * it would be an action with no visible effect.
 */
function AddReference({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term);
  const results = useDocumentSearch(debounced, open);
  const link = useLinkReference(document.id);

  const linked = new Set(document.referencedDocuments.map((reference) => reference.id));
  const candidates = (results.data?.items ?? []).filter(
    (item) => item.direction === 'INCOMING' && !linked.has(item.id),
  );

  const choose = (id: string) =>
    link.mutate(id, {
      onSuccess: () => {
        setOpen(false);
        setTerm('');
      },
      onError: (error) =>
        toast.error('Could not link that document', { description: refusalDescription(error) }),
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          {link.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
          Add reference
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        {/* `shouldFilter={false}`: the server already matched these rows within this reader's
            scope, and filtering them again in the browser would hide results that matched on a
            field this list does not show. */}
        <Command shouldFilter={false}>
          <CommandInput
            value={term}
            onValueChange={setTerm}
            placeholder="Search incoming documents"
          />
          <CommandList>
            {term.trim().length < DOCUMENT_SEARCH_MIN_LENGTH ? (
              <CommandEmpty>Type at least {DOCUMENT_SEARCH_MIN_LENGTH} characters.</CommandEmpty>
            ) : results.isFetching && candidates.length === 0 ? (
              <CommandEmpty>Searching…</CommandEmpty>
            ) : candidates.length === 0 ? (
              <CommandEmpty>No incoming document matches.</CommandEmpty>
            ) : (
              candidates.map((item) => (
                <CommandItem key={item.id} value={item.id} onSelect={choose}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{item.title}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">
                      {item.trackingNumber}
                    </span>
                  </span>
                </CommandItem>
              ))
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The referenced record, its attachments, and the selected one previewing beside them — all in
 * one modal (decision 167).
 *
 * It must **not** open `AttachmentPreviewDialog`, which is itself a `Dialog`: a dialog inside a
 * dialog traps focus in the inner one and closes both on a single Escape. Both render
 * `InlineFilePane` instead, which owns the fetch, the object URL and the sandboxed frame.
 *
 * No new endpoint. `/documents/:id` and `/documents/:id/attachments` are both scoped through
 * `requireReadableDocument`, so a reference that appears in this list at all is one the reader may
 * open, and it resolves through what already exists.
 */
function ReferenceDialog({
  reference,
  heading,
  onClose,
}: Readonly<{
  reference: ReferenceDocumentSummary | null;
  heading: string;
  onClose: () => void;
}>) {
  return (
    <Dialog open={reference !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[92vh] gap-3 sm:max-w-5xl">
        {reference === null ? null : (
          <>
            <DialogHeader>
              <DialogDescription className="eyebrow">{reference.trackingNumber}</DialogDescription>
              <DialogTitle className="truncate">{reference.title}</DialogTitle>
            </DialogHeader>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs tracking-wide text-muted-foreground uppercase">
                {heading}
              </span>
              <StatusBadge status={reference.status} />
              <span className="text-muted-foreground tabular-nums">
                Registered {new Date(reference.createdAt).toLocaleDateString()}
              </span>
              <Button asChild variant="ghost" size="sm" className="ml-auto">
                <Link href={`/documents/${reference.id}`}>
                  Open the full record
                  <ExternalLink />
                </Link>
              </Button>
            </div>

            <ReferenceAttachments documentId={reference.id} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The referenced record's files on one side, the selected one previewing on the other. */
function ReferenceAttachments({ documentId }: Readonly<{ documentId: string }>) {
  const attachments = useAttachments(documentId);
  const [selected, setSelected] = useState<AttachmentVersion | null>(null);

  if (attachments.isPending) {
    return <Skeleton className="h-[60vh] w-full" />;
  }

  const versions = (attachments.data ?? [])
    .flatMap((group) => group.versions)
    .filter((version) => version.isCurrent);
  const previewable = versions.filter(isPreviewable);
  // The first previewable file, until the reader picks another. Opening a reference to read it and
  // then having to click the only file in it is a step with no decision in it.
  const showing = selected ?? previewable[0] ?? null;

  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This document has no attachments to show here.
      </p>
    );
  }

  return (
    <div className="grid min-h-0 gap-3 sm:grid-cols-[14rem_minmax(0,1fr)]">
      <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
        {versions.map((version) => {
          const canPreview = isPreviewable(version);
          return (
            <li key={version.id}>
              <button
                type="button"
                disabled={!canPreview}
                onClick={() => setSelected(version)}
                className={cn(
                  'w-full rounded-md border border-border px-2 py-1.5 text-left',
                  showing?.id === version.id && 'border-primary bg-secondary/40',
                  canPreview
                    ? 'hover:bg-secondary/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
                    : 'cursor-not-allowed opacity-60',
                )}
              >
                <span className="block truncate text-sm">{version.originalName}</span>
                <span className="block text-xs text-muted-foreground">
                  {formatBytes(version.sizeBytes)}
                  {canPreview ? '' : ' · not previewable'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {showing === null ? (
        <p className="grid place-items-center text-sm text-muted-foreground">
          None of these files can be shown in the browser.
        </p>
      ) : (
        <InlineFilePane
          path={attachmentContentPath(documentId, showing.id)}
          name={showing.originalName}
          className="h-[60vh] max-h-[60vh]"
        />
      )}
    </div>
  );
}
