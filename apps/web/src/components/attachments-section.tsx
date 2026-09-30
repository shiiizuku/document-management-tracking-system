'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  downloadAttachment,
  fetchAttachments,
  formatBytes,
  isDownloadable,
  scanBadge,
  uploadAttachment,
  type AttachmentGroup,
} from '../lib/attachments';

interface AttachmentsSectionProps {
  documentId: string;
  /** Whether the upload control is offered (a frozen document rejects new attachments). */
  canUpload?: boolean;
  /** Called after a successful upload so the parent can reload the document (version bumped). */
  onUploaded?: () => void;
}

export function AttachmentsSection({
  documentId,
  canUpload = true,
  onUploaded,
}: AttachmentsSectionProps) {
  const [groups, setGroups] = useState<AttachmentGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setGroups(await fetchAttachments(documentId));
    } catch {
      setGroups([]);
    }
  }, [documentId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onFile = async (file: File | undefined, attachmentId?: string) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      await uploadAttachment(documentId, file, attachmentId);
      await refresh();
      onUploaded?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const download = async (versionId: string, fileName: string) => {
    setError('');
    try {
      await downloadAttachment(documentId, versionId, fileName);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Download failed');
    }
  };

  return (
    <div className="attachments">
      <div className="attachments-head">
        <h3>Attachments</h3>
        {canUpload && (
          <label className={busy ? 'attach-upload busy' : 'attach-upload'}>
            {busy ? 'Uploading…' : '+ Upload'}
            <input
              ref={fileInput}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={(event) => void onFile(event.target.files?.[0])}
            />
          </label>
        )}
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {groups.length === 0 ? (
        <p className="muted attach-empty">No attachments yet.</p>
      ) : (
        <ul className="attach-list">
          {groups.map((group) => (
            <li key={group.attachmentId} className="attach-group">
              {group.versions
                .slice()
                .sort((a, b) => b.versionNumber - a.versionNumber)
                .map((version) => {
                  const badge = scanBadge(version.scanStatus);
                  return (
                    <div key={version.id} className="attach-version">
                      <div className="attach-meta">
                        <strong>{version.originalName}</strong>
                        <small>
                          v{version.versionNumber} · {formatBytes(version.sizeBytes)}
                          {version.isCurrent && ' · current'}
                          {version.isSigned && ' · signed'}
                        </small>
                      </div>
                      <span className={`scan-badge scan-${badge.tone}`}>{badge.label}</span>
                      <button
                        type="button"
                        className="secondary compact"
                        disabled={!isDownloadable(version.scanStatus)}
                        title={
                          isDownloadable(version.scanStatus)
                            ? 'Download'
                            : 'Available once the file passes scanning'
                        }
                        onClick={() => void download(version.id, version.originalName)}
                      >
                        Download
                      </button>
                    </div>
                  );
                })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
