'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  DOCUMENT_PRIORITIES,
  DOCUMENT_TYPES,
  fetchMetadataRevisions,
  updateMetadata,
  type MetadataPatch,
  type MetadataRevision,
} from '../lib/documents';

export interface EditableDocument {
  id: string;
  version: number;
  title: string;
  type: string;
  description: string | null;
  priority: string;
  sender: string | null;
  company: string | null;
  referenceNumber: string | null;
  confidential: boolean;
}

interface MetadataEditModalProps {
  document: EditableDocument;
  onClose: () => void;
  onSaved: () => void;
}

/** Renders a revision field value for display; objects are JSON, nullish becomes an em dash. */
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '—';
};

const changedFields = (form: FormData, current: EditableDocument): Partial<MetadataPatch> => {
  const patch: Partial<MetadataPatch> = {};
  const text = (key: keyof MetadataPatch, currentValue: string | null) => {
    const raw = form.get(key);
    const next = (typeof raw === 'string' ? raw : '').trim();
    if (next !== (currentValue ?? '')) (patch as Record<string, unknown>)[key] = next;
  };
  text('title', current.title);
  text('type', current.type);
  text('description', current.description);
  text('priority', current.priority);
  text('sender', current.sender);
  text('company', current.company);
  text('referenceNumber', current.referenceNumber);
  const confidential = form.get('confidential') === 'on';
  if (confidential !== current.confidential) patch.confidential = confidential;
  return patch;
};

export function MetadataEditModal({ document: doc, onClose, onSaved }: MetadataEditModalProps) {
  const [revisions, setRevisions] = useState<MetadataRevision[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchMetadataRevisions(doc.id)
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, [doc.id]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const patch = changedFields(new FormData(event.currentTarget), doc);
    if (Object.keys(patch).length === 0) {
      setError('No changes to save.');
      return;
    }
    setSaving(true);
    try {
      await updateMetadata(doc.id, { expectedVersion: doc.version, ...patch });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save changes');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Metadata</p>
            <h2 id="edit-title">Edit document</h2>
          </div>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {error && (
          <div className="alert" role="alert">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="document-form">
          <label className="span-2">
            Title
            <input name="title" defaultValue={doc.title} required maxLength={240} />
          </label>
          <label>
            Type
            <select name="type" defaultValue={doc.type}>
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.charAt(0) + type.slice(1).toLowerCase().replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Priority
            <select name="priority" defaultValue={doc.priority}>
              {DOCUMENT_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority.charAt(0) + priority.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sender
            <input name="sender" defaultValue={doc.sender ?? ''} />
          </label>
          <label>
            Company / agency
            <input name="company" defaultValue={doc.company ?? ''} />
          </label>
          <label>
            External reference
            <input name="referenceNumber" defaultValue={doc.referenceNumber ?? ''} />
          </label>
          <label className="checkbox span-2">
            <input type="checkbox" name="confidential" defaultChecked={doc.confidential} />
            Confidential
          </label>
          <label className="span-2">
            Description
            <textarea name="description" rows={3} defaultValue={doc.description ?? ''} />
          </label>
          <div className="form-actions span-2">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        <div className="revision-history">
          <h3>Revision history</h3>
          {revisions.length === 0 ? (
            <p className="muted">No edits recorded yet.</p>
          ) : (
            <ul>
              {revisions
                .slice()
                .reverse()
                .map((revision) => (
                  <li key={revision.id}>
                    <small>{new Date(revision.occurredAt).toLocaleString()}</small>
                    <div className="revision-fields">
                      {Object.keys(revision.after).map((field) => (
                        <span key={field}>
                          <b>{field}</b>: {formatValue(revision.before[field])} →{' '}
                          {formatValue(revision.after[field])}
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
