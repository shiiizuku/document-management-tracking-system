import { api, API_URL } from './api';

export type ScanStatus = 'PENDING' | 'SCANNING' | 'CLEAN' | 'INFECTED' | 'ERROR';

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

export interface AttachmentGroup {
  attachmentId: string;
  versions: AttachmentVersion[];
}

export const fetchAttachments = (documentId: string): Promise<AttachmentGroup[]> =>
  api<AttachmentGroup[]>(`/documents/${documentId}/attachments`);

/**
 * Uploads a file as multipart/form-data. This bypasses the JSON `api` helper on purpose: the
 * browser must set the `multipart/form-data` boundary itself, so no `Content-Type` is sent.
 */
export async function uploadAttachment(
  documentId: string,
  file: File,
  attachmentId?: string,
): Promise<AttachmentVersion> {
  const body = new FormData();
  body.set('file', file);
  if (attachmentId) body.set('attachmentId', attachmentId);
  const response = await fetch(`${API_URL}/documents/${documentId}/attachments`, {
    method: 'POST',
    credentials: 'include',
    body,
  });
  const payload = (await response.json()) as {
    data?: AttachmentVersion;
    error?: { message?: string };
  };
  if (!response.ok) throw new Error(payload.error?.message ?? 'Upload failed');
  return payload.data as AttachmentVersion;
}

/**
 * Downloads a clean attachment's bytes and hands them to the browser as a file. Fetched with
 * credentials (rather than a bare link) so the session cookie always accompanies the request and
 * a fail-closed 409 surfaces as a thrown error instead of a broken navigation.
 */
export async function downloadAttachment(
  documentId: string,
  versionId: string,
  fileName: string,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/documents/${documentId}/attachments/${versionId}/download`,
    { credentials: 'include' },
  );
  if (!response.ok) {
    let message = 'Download failed';
    try {
      const payload = (await response.json()) as { error?: { message?: string } };
      message = payload.error?.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const SCAN_LABELS: Record<ScanStatus, string> = {
  PENDING: 'Scan pending',
  SCANNING: 'Scanning',
  CLEAN: 'Clean',
  INFECTED: 'Infected',
  ERROR: 'Scan error',
};

/** Presentation for a scan status: a label and a CSS modifier. Pure, so it is unit-tested. */
export const scanBadge = (status: ScanStatus): { label: string; tone: string } => ({
  label: SCAN_LABELS[status] ?? status,
  tone: status.toLowerCase(),
});

/** Whether a version's bytes may be downloaded — only a clean scan clears the quarantine. */
export const isDownloadable = (status: ScanStatus): boolean => status === 'CLEAN';

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
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
};
