'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/api';
import { useDeleteDocument, type DocumentDetail } from './queries';

/**
 * Removes a document from the registry.
 *
 * Logical, not physical: the row keeps its tracking number, its timeline and its files, and an
 * administrator can put it back. What changes is that it leaves every list and its own detail route
 * — which is also why this navigates away on success rather than leaving the user on a page that is
 * about to answer 404.
 *
 * It carries `expectedVersion` like every other mutation, so deleting a document somebody else has
 * just acted on is refused rather than silently applied to a state the deleter never saw.
 */
export function DeleteDocumentDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const remove = useDeleteDocument(document.id);

  const onConfirm = () =>
    remove.mutate(
      { expectedVersion: document.version },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(`Deleted ${document.trackingNumber}`, {
            description: 'It can be restored from Deleted documents in the registry.',
          });
          router.push('/documents');
        },
        onError: (error) => {
          // A 409 means it moved while the dialog was open. The mutation has already refetched it,
          // so the only thing left is to say so: retrying against a version that no longer exists
          // would simply fail again.
          if (error instanceof ApiError && error.isConflict) {
            setOpen(false);
            toast.error('This document changed — review and retry', {
              description:
                'Someone else acted on it while it was open. The latest version is now shown.',
            });
            return;
          }
          toast.error('Could not delete this document', {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-destructive">
          <Trash2 />
          Delete
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <p className="eyebrow">Delete document</p>
          <DialogTitle>{document.trackingNumber}</DialogTitle>
          <DialogDescription>{document.title}</DialogDescription>
        </DialogHeader>

        <Alert>
          <Trash2 />
          <AlertTitle>This is reversible</AlertTitle>
          <AlertDescription>
            <p>
              The document leaves the registry and every search, and nobody can open it. Its files,
              timeline and tracking number are kept, and an administrator can restore it from
              Deleted documents. The deletion itself is recorded in the audit trail.
            </p>
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={remove.isPending}
          >
            {remove.isPending ? <Loader2 className="animate-spin" /> : null}
            Delete document
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
