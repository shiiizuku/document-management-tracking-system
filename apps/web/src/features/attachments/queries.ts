'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ScanStatus } from '@dts/contracts';
import { api, download, inlineContent, upload, type InlineContent } from '@/lib/api';
import { invalidateDocument } from '@/features/documents/queries';

/**
 * A document's attached files and their scan state.
 *
 * The one rule this module exists to keep honest: bytes are quarantined until the scanner clears
 * them. The API fails closed on every download of a version that is not `CLEAN`, and the UI must
 * agree — a download button that produces a 409 teaches users to ignore the badge beside it.
 */

export interface AttachmentVersion {
  id: string;
  attachmentId: string;
  versionNumber: number;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploaderId: string;
  uploadedAt: string;
  scanStatus: ScanStatus;
  isCurrent: boolean;
  isSigned: boolean;
}

/** One logical attachment and every version of it, newest last. */
export interface AttachmentGroup {
  attachmentId: string;
  versions: AttachmentVersion[];
}

const attachmentKeys = {
  forDocument: (documentId: string) => ['documents', 'attachments', documentId] as const,
};

export function useAttachments(documentId: string) {
  return useQuery({
    queryKey: attachmentKeys.forDocument(documentId),
    queryFn: () => api<AttachmentGroup[]>(`/documents/${documentId}/attachments`),
  });
}

/**
 * Uploads a file, either as a new attachment or as the next version of an existing one.
 *
 * Goes through the transport's `upload()` rather than `api()` because the browser has to set the
 * multipart boundary itself. A rejected upload — too large, wrong type, document not editable —
 * still surfaces as the same `ApiError` every other failure does.
 */
export function useUploadAttachment(documentId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ file, attachmentId }: { file: File; attachmentId?: string }) => {
      const body = new FormData();
      body.set('file', file);
      if (attachmentId !== undefined) body.set('attachmentId', attachmentId);
      return upload<AttachmentVersion>(`/documents/${documentId}/attachments`, body);
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: attachmentKeys.forDocument(documentId) });
      // A new version resets the document's clean/signed flags, which gate the release action,
      // so the document itself is now stale too.
      invalidateDocument(client, documentId);
    },
  });
}

/**
 * Uploads a file to a document named per call rather than per hook.
 *
 * The sibling above binds its `documentId` when the hook is constructed, which is right for the
 * attachments section — it belongs to one open record. Registration is the case that cannot use
 * it: the document does not exist when the form mounts, so the id only arrives with the create
 * response, and a hook cannot be re-made at that point.
 *
 * Deliberately NOT a cache-invalidating mutation per file. The caller uploads a batch and then
 * navigates to the new record, which mounts the attachments query fresh; invalidating a key
 * nothing is subscribed to would be work for no observer.
 */
export function useUploadAttachmentToDocument() {
  return useMutation({
    mutationFn: ({ documentId, file }: { documentId: string; file: File }) => {
      const body = new FormData();
      body.set('file', file);
      return upload<AttachmentVersion>(`/documents/${documentId}/attachments`, body);
    },
  });
}

/**
 * Downloads a version's bytes.
 *
 * Fetched with credentials through `download()` rather than offered as a plain link: a link would
 * navigate away on a fail-closed 409 and show the user a raw error page instead of a message
 * beside the file they clicked.
 */
export function useDownloadAttachment(documentId: string) {
  return useMutation({
    mutationFn: (version: AttachmentVersion) =>
      download(`/documents/${documentId}/attachments/${version.id}/download`, version.originalName),
  });
}

/**
 * Fetches a version's bytes for the in-page preview.
 *
 * A mutation rather than a query, and deliberately: the result owns an object URL that has to be
 * released, and a cached query would hand the same URL to a second viewer after the first one
 * revoked it. Modelled as an action the viewer performs once, whose result the viewer then owns.
 */
export function usePreviewAttachment(documentId: string) {
  return useMutation({
    mutationFn: (version: AttachmentVersion): Promise<InlineContent> =>
      inlineContent(`/documents/${documentId}/attachments/${version.id}/content`),
  });
}

/** Whether a version's bytes may leave the quarantine. Only a clean scan clears it. */
export const isDownloadable = (status: ScanStatus): boolean => status === 'CLEAN';

/**
 * The media types the browser is asked to render in place.
 *
 * Mirrors the API's own preview allow-list. Duplicated across the seam on purpose: the server
 * refuses anything else with a 415, so the cost of this list being wrong is a button that fails
 * rather than a file served unsafely — and the alternative, offering Preview on every attachment
 * and letting a third of them error, is worse than the duplication.
 */
const PREVIEWABLE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/** Whether this version can be shown on the page: cleared by the scanner, and a renderable type. */
export const isPreviewable = (version: AttachmentVersion): boolean =>
  isDownloadable(version.scanStatus) && PREVIEWABLE_MEDIA_TYPES.has(version.mediaType);

/** Whether a preview should render as an image rather than in a document frame. */
export const isImageMediaType = (mediaType: string): boolean => mediaType.startsWith('image/');

const SCAN_LABELS: Record<ScanStatus, string> = {
  PENDING: 'Scan pending',
  PENDING_RETRY: 'Scan retrying',
  CLEAN: 'Clean',
  INFECTED: 'Infected',
  SCAN_FAILED: 'Scan failed',
};

/**
 * What a scan state means to someone deciding whether to trust a file, and how it should look.
 *
 * `PENDING_RETRY` and `SCAN_FAILED` are deliberately distinct: the first will resolve on its own,
 * the second needs someone to act. A single "not clean" badge would leave the user unable to tell
 * "wait a moment" from "this will never clear".
 */
export const scanBadge = (
  status: ScanStatus,
): { label: string; variant: 'secondary' | 'destructive' | 'outline' } => {
  if (status === 'CLEAN') return { label: SCAN_LABELS.CLEAN, variant: 'secondary' };
  if (status === 'INFECTED' || status === 'SCAN_FAILED')
    return { label: SCAN_LABELS[status], variant: 'destructive' };
  return { label: SCAN_LABELS[status], variant: 'outline' };
};

/** Human-readable byte size, e.g. "2.4 MB". */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit] ?? 'GB'}`;
};
