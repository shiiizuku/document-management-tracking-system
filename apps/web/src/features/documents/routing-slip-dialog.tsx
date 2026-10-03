'use client';

import { useState } from 'react';
import { Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { InlineFilePane } from '@/components/dts/inline-file-pane';
import { routingSlipPreviewPath, useRoutingSlip, type DocumentDetail } from './queries';

/**
 * The routing slip, on screen first and downloaded only if someone asks (decision 170).
 *
 * It used to be a button that produced a file. That made every look at the slip an export in the
 * audit trail, which is the one distinction the trail is there to draw: the question an auditor
 * asks about a routing slip is who took a copy out of the building, and an officer checking where
 * a document had been was indistinguishable from one who did.
 *
 * So opening this writes `document.routing-slip-viewed` and the Download button *inside* it writes
 * `document.routing-slip-exported` — two server routes, because the audit event belongs beside the
 * response that caused it and nothing a caller flips should be able to make a download record
 * itself as a read.
 *
 * Offered to anyone who can read the document, with no capability of its own: the slip shows
 * nothing the page behind it does not, and it is the artefact that travels stapled to the physical
 * document.
 */
export function RoutingSlipDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const slip = useRoutingSlip();

  const download = () =>
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Printer />
          Routing slip
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Routing slip</DialogTitle>
          <DialogDescription className="tabular-nums">
            {document.trackingNumber} · {document.title}
          </DialogDescription>
        </DialogHeader>

        {/* Mounted only while open, which is what makes opening the dialog the thing that fetches
            the slip — and therefore the thing the server records as a view. */}
        {open ? (
          <InlineFilePane
            path={routingSlipPreviewPath(document.id)}
            name={`routing slip for ${document.trackingNumber}`}
            className="h-[70vh] max-h-[70vh]"
          />
        ) : null}

        <div className="flex justify-end">
          <Button type="button" variant="secondary" onClick={download} disabled={slip.isPending}>
            {slip.isPending ? <Loader2 className="animate-spin" /> : <Download />}
            Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
