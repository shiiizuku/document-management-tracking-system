'use client';

import { useState } from 'react';
import { AlertCircle, ArchiveRestore, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/dts/empty-state';
import { StatusBadge } from '@/components/dts/status-badge';
import { ApiError } from '@/lib/api';
import { useDeletedDocuments, useRestoreDocument, type DocumentListItem } from './queries';
import { useDocumentTypeLabel } from '@/features/org/queries';

/**
 * The deleted documents, and the way back.
 *
 * A dialog rather than a route, because this is a recovery tool and not a place anyone works: it is
 * opened to undo one mistake and then closed. Making it a route would also put a second,
 * nearly-identical registry in the navigation, which is how people end up unsure which list is the
 * real one.
 *
 * It is the *only* place a deleted document can be reached. The registry omits them and the detail
 * route answers 404, so without this list the restore endpoint has no caller — which is also why it
 * exists on the server at all.
 *
 * The list is fetched only while the dialog is open. A deleted-items query on every visit to the
 * registry would ask a question nobody on screen has.
 */
export function DeletedDocumentsDialog() {
  const [open, setOpen] = useState(false);
  const deleted = useDeletedDocuments(open);
  const rows = deleted.data ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Trash2 />
          Deleted
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <p className="eyebrow">Recovery</p>
          <DialogTitle>Deleted documents</DialogTitle>
          <DialogDescription>
            Documents removed from the registry that you may restore. Everything about them was
            kept.
          </DialogDescription>
        </DialogHeader>

        {deleted.isPending ? (
          <div className="space-y-2" aria-hidden>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : deleted.error !== null ? (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>This list could not be loaded</AlertTitle>
            <AlertDescription>
              <p>
                {deleted.error instanceof Error ? deleted.error.message : 'Something went wrong.'}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => void deleted.refetch()}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="Nothing has been deleted"
            description="Deleted documents appear here until they are restored."
            className="py-10"
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {rows.map((row) => (
              <DeletedRow key={row.id} document={row} />
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeletedRow({ document }: Readonly<{ document: DocumentListItem }>) {
  const typeLabel = useDocumentTypeLabel();
  const restore = useRestoreDocument();

  const onRestore = () =>
    restore.mutate(
      // The version comes from this list, which is the only read that can see a deleted row — so it
      // is also the only place the optimistic-concurrency token for a restore can come from.
      { id: document.id, expectedVersion: document.version },
      {
        onSuccess: () =>
          toast.success(`Restored ${document.trackingNumber}`, {
            description: 'It is back in the registry, in the state it was deleted in.',
          }),
        onError: (error) =>
          toast.error('Could not restore this document', {
            description:
              error instanceof ApiError && error.isConflict
                ? 'It changed since this list was loaded. The list has been refreshed — try again.'
                : error instanceof Error
                  ? error.message
                  : 'Please try again.',
          }),
      },
    );

  return (
    <li className="flex flex-wrap items-center gap-3 bg-card px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{document.title}</div>
        <div className="text-xs text-muted-foreground">
          {document.trackingNumber} · {typeLabel(document.type)}
        </div>
      </div>
      <StatusBadge status={document.status} />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRestore}
        disabled={restore.isPending}
      >
        {restore.isPending ? <Loader2 className="animate-spin" /> : <ArchiveRestore />}
        Restore
      </Button>
    </li>
  );
}
