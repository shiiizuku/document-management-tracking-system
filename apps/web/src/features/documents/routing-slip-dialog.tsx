'use client';

import { useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { inlineContent } from '@/lib/api';
import { routingSlipExportPath, type DocumentDetail } from './queries';

/**
 * The routing slip, sent to the browser's print preview (decision 170).
 *
 * Printing is taking a copy out of the building — the slip is the sheet that is stapled to the
 * physical document — so it is fetched through the *export* route and the server records
 * `document.routing-slip-exported`, not a view. The bytes go into an off-screen frame and that
 * frame is printed, which brings up the browser's print dialog and its preview with no on-page
 * viewer in between.
 *
 * The frame and its object URL are released a minute after printing is requested — long enough for
 * the print dialog to have taken what it needs, short enough that the file does not linger.
 */
export function RoutingSlipDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [busy, setBusy] = useState(false);

  const print = async () => {
    setBusy(true);
    try {
      const content = await inlineContent(routingSlipExportPath(document.id));
      const frame = window.document.createElement('iframe');
      frame.title = `Routing slip for ${document.trackingNumber}`;
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText =
        'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      const cleanup = () => {
        frame.remove();
        content.release();
      };
      frame.onload = () => {
        // The PDF viewer inside the frame finishes laying out after `load`; printing earlier
        // yields a blank page.
        setTimeout(() => {
          try {
            frame.contentWindow?.focus();
            frame.contentWindow?.print();
          } catch {
            toast.error('Could not open the print preview', {
              description: 'Please try again.',
            });
          }
          setTimeout(cleanup, 60_000);
        }, 500);
      };
      frame.src = content.url;
      window.document.body.append(frame);
    } catch (error) {
      toast.error('Could not produce the routing slip', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" onClick={print} disabled={busy}>
      {busy ? <Loader2 className="animate-spin" /> : <Printer />}
      Routing slip
    </Button>
  );
}
