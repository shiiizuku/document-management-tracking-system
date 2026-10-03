'use client';

import { useState } from 'react';
import { Eye } from 'lucide-react';
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
import { attachmentContentPath, formatBytes, type AttachmentVersion } from './queries';

/**
 * Reads an attachment on the page instead of downloading it.
 *
 * Most of what the records office receives is a one-page scan, and the old flow — save the file,
 * find it, open it in another application, come back — is the single most repeated friction in the
 * workflow. This removes it for the formats a browser can render, and only for those: the Download
 * button stays, and is the answer for everything else.
 *
 * The dialog owns when a preview is open; {@link InlineFilePane} owns the fetch, the object URL
 * and the sandboxed frame, which the Reference Document modal renders too (decision 167). Mounting
 * the pane only while the dialog is open is what starts the request on open and releases the blob
 * on close, with no effect of this component's own.
 */
export function AttachmentPreviewDialog({
  documentId,
  version,
}: Readonly<{ documentId: string; version: AttachmentVersion }>) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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

        {open ? (
          <InlineFilePane
            path={attachmentContentPath(documentId, version.id)}
            name={version.originalName}
            className="h-[70vh] max-h-[70vh]"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
