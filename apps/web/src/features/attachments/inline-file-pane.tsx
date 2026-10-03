'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { InlineContent } from '@/lib/api';
import { isImageMediaType, usePreviewAttachment, type AttachmentVersion } from './queries';

/**
 * A file rendered on the page: the fetch, the object URL it produces, the release of that URL,
 * and the sandboxed frame it is drawn in.
 *
 * Pulled out of `AttachmentPreviewDialog` because the Reference Document modal (decision 167)
 * shows the referenced record's attachments *with preview inline in that same modal* — so it
 * cannot open the preview dialog, which is itself a `Dialog`, and nesting one inside another
 * traps focus in the inner one and closes both on a single Escape.
 *
 * The bytes arrive as a `blob:` URL from the transport, because the API is on another origin and
 * an `<img src>` or `<iframe src>` pointed at it would issue its own request without the session
 * cookie. That URL is held by the document until it is revoked, so this component releases it when
 * the selected version changes and when it unmounts — a pane that switches between twenty
 * attachments must not leave twenty files in memory. Having one owner of that rule is the actual
 * reason to share this rather than copy the markup: the leak is in the lifecycle, not in the JSX.
 *
 * The frame is sandboxed with no `allow-` tokens, which puts a rendered PDF in an opaque origin
 * with no scripting: a document that arrived from outside the office is untrusted content, and
 * rendering it is a place where that matters. The API sends a matching `Content-Security-Policy`
 * for anyone who reaches the URL directly.
 */
export function InlineFilePane({
  documentId,
  version,
  className,
}: Readonly<{ documentId: string; version: AttachmentVersion; className?: string }>) {
  const [content, setContent] = useState<InlineContent | null>(null);
  const preview = usePreviewAttachment(documentId);
  const { mutate, reset } = preview;

  useEffect(() => {
    let current: InlineContent | null = null;
    setContent(null);
    reset();
    mutate(version, {
      onSuccess: (fetched) => {
        current = fetched;
        setContent(fetched);
      },
    });
    // Covers both ways a preview ends — a different version selected, and the pane unmounting —
    // so the object URL cannot be leaked by whichever path a future caller forgets about.
    return () => current?.release();
  }, [documentId, version, mutate, reset]);

  if (preview.isPending || (preview.isIdle && content === null)) {
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

  if (preview.error !== null) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>This file could not be previewed</AlertTitle>
        <AlertDescription>
          <p>
            {preview.error instanceof Error
              ? preview.error.message
              : 'Something went wrong. Download it instead.'}
          </p>
        </AlertDescription>
      </Alert>
    );
  }

  if (content === null) return null;

  if (isImageMediaType(content.mediaType)) {
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
        <img src={content.url} alt={version.originalName} className="max-w-full" />
      </div>
    );
  }

  return (
    <iframe
      src={content.url}
      title={`Preview of ${version.originalName}`}
      sandbox=""
      className={cn('w-full rounded-md border border-border bg-secondary/30', className)}
    />
  );
}
