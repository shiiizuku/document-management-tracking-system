'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, Eye, Loader2 } from 'lucide-react';
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
import type { InlineContent } from '@/lib/api';
import {
  formatBytes,
  isImageMediaType,
  usePreviewAttachment,
  type AttachmentVersion,
} from './queries';

/**
 * Reads an attachment on the page instead of downloading it.
 *
 * Most of what the records office receives is a one-page scan, and the old flow — save the file,
 * find it, open it in another application, come back — is the single most repeated friction in the
 * workflow. This removes it for the formats a browser can render, and only for those: the Download
 * button stays, and is the answer for everything else.
 *
 * The bytes arrive as a `blob:` URL from the transport, because the API is on another origin and
 * an `<img src>` or `<iframe src>` pointed at it would issue its own request without the session
 * cookie. That URL is held by the document until it is revoked, so this component releases it on
 * close and on unmount — a preview dialog opened twenty times must not leave twenty files in
 * memory.
 *
 * The frame is sandboxed with no `allow-` tokens, which puts a rendered PDF in an opaque origin
 * with no scripting: a document that arrived from outside the office is untrusted content, and
 * rendering it is a place where that matters. The API sends a matching `Content-Security-Policy`
 * for anyone who reaches the URL directly.
 */
export function AttachmentPreviewDialog({
  documentId,
  version,
}: Readonly<{ documentId: string; version: AttachmentVersion }>) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<InlineContent | null>(null);
  const preview = usePreviewAttachment(documentId);

  // One effect for both ways a preview ends — the dialog closing and the component unmounting —
  // so the object URL cannot be leaked by whichever path a future caller forgets about.
  useEffect(() => {
    if (open) return undefined;
    return () => content?.release();
  }, [open, content]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      preview.mutate(version, { onSuccess: setContent });
      return;
    }
    content?.release();
    setContent(null);
    preview.reset();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Eye />
          Preview
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="truncate">{version.originalName}</DialogTitle>
          <DialogDescription>
            Version {version.versionNumber} · {formatBytes(version.sizeBytes)} · {version.mediaType}
          </DialogDescription>
        </DialogHeader>

        {preview.isPending ? (
          <div
            className="grid h-[70vh] place-items-center"
            role="status"
            aria-label="Loading preview"
          >
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : preview.error !== null ? (
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
        ) : content === null ? null : isImageMediaType(content.mediaType) ? (
          <div className="grid max-h-[70vh] place-items-center overflow-auto rounded-md border border-border bg-secondary/30">
            {/* A plain <img>, not `next/image`: the bytes are a blob this page fetched, so there is
                nothing for an image loader to optimise and it would only fail on a URL it cannot
                resolve. */}
            <img src={content.url} alt={version.originalName} className="max-w-full" />
          </div>
        ) : (
          <iframe
            src={content.url}
            title={`Preview of ${version.originalName}`}
            sandbox=""
            className="h-[70vh] w-full rounded-md border border-border bg-secondary/30"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
