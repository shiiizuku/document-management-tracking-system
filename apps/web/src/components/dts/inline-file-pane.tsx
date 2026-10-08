'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { inlineContent, type InlineContent } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * A file rendered on the page: the fetch, the object URL it produces, the release of that URL, and
 * the sandboxed frame it is drawn in.
 *
 * Pulled out of `AttachmentPreviewDialog` because two other surfaces need the same thing inside a
 * dialog they already own — the Reference Document modal, which shows the referenced record's
 * attachments *with preview inline in that same modal* (decision 167), and the routing slip, which
 * opens on screen before anyone exports it (decision 170). Neither can open the preview dialog,
 * which is itself a `Dialog`: nested, focus is trapped in the inner one and one Escape closes both.
 *
 * Addressed by **path** rather than by an attachment, because the three callers fetch different
 * things from different routes and only two of them have an attachment at all. A string is also a
 * stable dependency, which is what lets the effect below key off it.
 *
 * The bytes arrive as a `blob:` URL from the transport, because the API is on another origin and
 * an `<img src>` or `<iframe src>` pointed at it would issue its own request without the session
 * cookie. That URL is held by the document until it is revoked, so this releases it when the path
 * changes and when it unmounts — a pane switched between twenty attachments must not leave twenty
 * files in memory. Having one owner of that rule is the actual reason to share this rather than
 * copy the markup: the leak is in the lifecycle, not in the JSX.
 *
 * The frame is sandboxed. `trusted` picks which sandbox, and the choice is forced rather than
 * stylistic: Chromium renders PDFs with a viewer that is itself scripted, so `sandbox=""` shows a
 * blank frame where a PDF should be. `allow-scripts` without `allow-same-origin` lets that viewer
 * run while keeping the frame in an opaque origin — it cannot reach this page, its storage or its
 * cookies, and it still has no top-navigation, forms, popups or downloads.
 *
 * What it does permit is outbound requests from inside that opaque origin, and for a `blob:` URL
 * there is no second line of defence: the API's `Content-Security-Policy` travels with the
 * *response*, and a blob URL does not carry it. So a document that arrived from outside the office
 * keeps the strict `sandbox=""` — a blank frame is a worse preview but it is not a channel — and
 * only bytes this system produced itself, the routing slip, are rendered with the viewer enabled.
 */
export function InlineFilePane({
  path,
  name,
  className,
  trusted = false,
}: Readonly<{ path: string; name: string; className?: string; trusted?: boolean }>) {
  const [content, setContent] = useState<InlineContent | null>(null);

  /*
   * A mutation rather than a query, and deliberately: the result owns an object URL that has to be
   * released, and a cached query would hand the same URL to a second viewer after the first one
   * revoked it. Modelled as an action the viewer performs once, whose result the viewer then owns.
   */
  const fetchFile = useMutation({
    mutationFn: (target: string): Promise<InlineContent> => inlineContent(target),
  });
  const { mutate, reset } = fetchFile;

  useEffect(() => {
    let fetched: InlineContent | null = null;
    setContent(null);
    reset();
    mutate(path, {
      onSuccess: (result) => {
        fetched = result;
        setContent(result);
      },
    });
    // Covers both ways a preview ends — a different file selected, and the pane unmounting — so
    // the object URL cannot be leaked by whichever path a future caller forgets about.
    return () => fetched?.release();
  }, [path, mutate, reset]);

  if (fetchFile.error !== null) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>This file could not be shown</AlertTitle>
        <AlertDescription>
          <p>
            {fetchFile.error instanceof Error
              ? fetchFile.error.message
              : 'Something went wrong. Download it instead.'}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (content === null) {
    return (
      <div
        className={cn('grid place-items-center', className)}
        role="status"
        aria-label="Loading preview"
      >
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (content.mediaType.startsWith('image/')) {
    return (
      <div
        className={cn(
          'grid place-items-center overflow-auto rounded-md border border-border bg-secondary/30',
          className,
        )}
      >
        {/* A plain <img>, not `next/image`: the bytes are a blob this page fetched, so there is
            nothing for an image loader to optimise and it would only fail on a URL it cannot
            resolve. */}
        <img src={content.url} alt={name} className="max-w-full" />
      </div>
    );
  }

  /*
   * Chrome refuses to show its PDF viewer inside ANY sandboxed frame — "This page has been blocked
   * by Chrome" — whatever `allow-*` flags are set. A blob typed `application/pdf` can only be
   * handed to that viewer, never parsed as HTML, so it cannot run in this page's origin; the
   * sandbox is dropped for it alone. Every other non-image type keeps the sandbox below.
   *
   * The viewer's own toolbar offers a save button that never touches the audited download route,
   * so it is hidden with the `#toolbar=0` open parameter. That is a courtesy to the audit trail,
   * not enforcement: someone determined can still save the blob.
   */
  if (content.mediaType.split(';')[0]?.trim().toLowerCase() === 'application/pdf') {
    return (
      <iframe
        src={`${content.url}#toolbar=0&navpanes=0`}
        title={`Preview of ${name}`}
        className={cn('w-full rounded-md border border-border bg-secondary/30', className)}
      />
    );
  }

  return (
    <iframe
      src={content.url}
      title={`Preview of ${name}`}
      sandbox={trusted ? 'allow-scripts' : ''}
      className={cn('w-full rounded-md border border-border bg-secondary/30', className)}
    />
  );
}
