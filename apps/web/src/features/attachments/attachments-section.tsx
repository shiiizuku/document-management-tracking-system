'use client';

import { useRef, useState } from 'react';
import { Download, FileUp, Loader2, Paperclip, PenLine, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/dts/empty-state';
import {
  formatBytes,
  isDownloadable,
  scanBadge,
  useAttachments,
  useDownloadAttachment,
  useUploadAttachment,
  type AttachmentGroup,
  type AttachmentVersion,
} from './queries';

/**
 * A document's files: every version, what the scanner made of each, and the one download control
 * the quarantine allows.
 *
 * Versions are immutable and all of them stay visible — the point of the attachment history is
 * that a signature applies to specific bytes, so replacing a file must never look like editing
 * one. The newest version of each attachment is the "current" one the workflow reads.
 */
export function AttachmentsSection({
  documentId,
  canUpload,
}: Readonly<{ documentId: string; canUpload: boolean }>) {
  const attachments = useAttachments(documentId);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Paperclip className="size-4 text-muted-foreground" aria-hidden />
          Attachments
        </h3>
        {canUpload ? <UploadButton documentId={documentId} /> : null}
      </div>

      {attachments.isPending ? (
        <div className="space-y-2" aria-hidden>
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : attachments.error !== null ? (
        <p className="text-sm text-destructive">
          {attachments.error instanceof Error
            ? attachments.error.message
            : 'The attachment list could not be loaded.'}
        </p>
      ) : (attachments.data ?? []).length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No files attached"
          description={
            canUpload
              ? 'Upload the scanned document. Every upload is versioned and virus-scanned before it can be downloaded.'
              : 'Nothing has been attached to this document yet.'
          }
          className="py-8"
        />
      ) : (
        <ul className="space-y-3">
          {(attachments.data ?? []).map((group) => (
            <AttachmentCard
              key={group.attachmentId}
              documentId={documentId}
              group={group}
              canUpload={canUpload}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function AttachmentCard({
  documentId,
  group,
  canUpload,
}: Readonly<{ documentId: string; group: AttachmentGroup; canUpload: boolean }>) {
  // Newest first: the current version is what the workflow acts on, so it leads.
  const versions = [...group.versions].sort((a, b) => b.versionNumber - a.versionNumber);

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-card">
      <ul className="divide-y divide-border">
        {versions.map((version) => (
          <VersionRow key={version.id} documentId={documentId} version={version} />
        ))}
      </ul>
      {canUpload ? (
        <div className="border-t border-border bg-secondary/30 px-3 py-2">
          <UploadButton
            documentId={documentId}
            attachmentId={group.attachmentId}
            label="Upload new version"
            variant="ghost"
          />
        </div>
      ) : null}
    </li>
  );
}

function VersionRow({
  documentId,
  version,
}: Readonly<{ documentId: string; version: AttachmentVersion }>) {
  const badge = scanBadge(version.scanStatus);
  const downloadable = isDownloadable(version.scanStatus);
  const downloadFile = useDownloadAttachment(documentId);

  const onDownload = () =>
    downloadFile.mutate(version, {
      onError: (error) =>
        toast.error('Download refused', {
          description: error instanceof Error ? error.message : 'Please try again.',
        }),
    });

  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {version.originalName}
          </span>
          {version.isCurrent ? (
            <Badge variant="secondary" className="shrink-0">
              Current
            </Badge>
          ) : null}
          {version.isSigned ? (
            <Badge variant="outline" className="shrink-0">
              <PenLine aria-hidden />
              Signed
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          v{version.versionNumber} · {formatBytes(version.sizeBytes)} ·{' '}
          <time dateTime={version.uploadedAt}>{new Date(version.uploadedAt).toLocaleString()}</time>
        </p>
      </div>

      <Badge variant={badge.variant} className="shrink-0">
        {downloadable ? null : <ShieldAlert aria-hidden />}
        {badge.label}
      </Badge>

      {/*
        No button at all until the scan clears, rather than a disabled one: the badge beside it
        already says why, and a permanently disabled control invites repeated clicking.
      */}
      {downloadable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDownload}
          disabled={downloadFile.isPending}
        >
          {downloadFile.isPending ? <Loader2 className="animate-spin" /> : <Download />}
          Download
        </Button>
      ) : null}
    </li>
  );
}

/**
 * A file picker that uploads immediately on selection.
 *
 * The native input stays hidden behind a button: its default rendering cannot be styled to match
 * anything, and the two-step "choose a file, then press Upload" it implies has no purpose when
 * there is exactly one thing to do with the choice.
 */
function UploadButton({
  documentId,
  attachmentId,
  label = 'Upload file',
  variant = 'outline',
}: Readonly<{
  documentId: string;
  attachmentId?: string;
  label?: string;
  variant?: 'outline' | 'ghost';
}>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const uploadFile = useUploadAttachment(documentId);

  const onFileChosen = (file: File) => {
    setUploadingName(file.name);
    uploadFile.mutate(attachmentId === undefined ? { file } : { file, attachmentId }, {
      onSuccess: (version) => {
        toast.success(`Uploaded ${version.originalName}`, {
          description: 'It becomes downloadable once the virus scan reports it clean.',
        });
      },
      onError: (error) =>
        toast.error('Upload failed', {
          description: error instanceof Error ? error.message : 'Please try again.',
        }),
      onSettled: () => {
        setUploadingName(null);
        // Clearing the input is what makes re-uploading the same filename fire a change event.
        if (inputRef.current) inputRef.current.value = '';
      },
    });
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFileChosen(file);
        }}
      />
      <Button
        type="button"
        variant={variant}
        size="sm"
        disabled={uploadFile.isPending}
        onClick={() => inputRef.current?.click()}
      >
        {uploadFile.isPending ? <Loader2 className="animate-spin" /> : <FileUp />}
        {uploadingName === null ? label : `Uploading ${uploadingName}`}
      </Button>
    </>
  );
}
