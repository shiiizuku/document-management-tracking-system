'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { routeDocument } from '../lib/documents';
import { fetchDivisions, fetchSections, type Division, type Section } from '../lib/organization';

interface RouteModalProps {
  documentId: string;
  expectedVersion: number;
  /** The document's current division, excluded from the target list (routing there is a no-op). */
  currentDivisionId: string;
  onClose: () => void;
  onRouted: () => void;
}

export function RouteModal({
  documentId,
  expectedVersion,
  currentDivisionId,
  onClose,
  onRouted,
}: RouteModalProps) {
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [toDivisionId, setToDivisionId] = useState('');
  const [toSectionId, setToSectionId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void fetchDivisions()
      .then((rows) => setDivisions(rows.filter((division) => division.id !== currentDivisionId)))
      .catch(() => setDivisions([]));
  }, [currentDivisionId]);

  useEffect(() => {
    if (!toDivisionId) {
      setSections([]);
      return;
    }
    void fetchSections(toDivisionId)
      .then(setSections)
      .catch(() => setSections([]));
    setToSectionId('');
  }, [toDivisionId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!toDivisionId) {
      setError('Choose a destination division.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await routeDocument(documentId, {
        expectedVersion,
        toDivisionId,
        ...(toSectionId ? { toSectionId } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      onRouted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to forward the document');
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
        aria-labelledby="route-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <p className="eyebrow">Routing</p>
            <h2 id="route-title">Forward document</h2>
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
          <label>
            To division
            <select
              value={toDivisionId}
              onChange={(event) => setToDivisionId(event.target.value)}
              required
            >
              <option value="" disabled>
                Select a division…
              </option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            To section
            <select
              value={toSectionId}
              onChange={(event) => setToSectionId(event.target.value)}
              disabled={sections.length === 0}
            >
              <option value="">
                {sections.length === 0 ? 'No sections' : 'Division-level (no section)'}
              </option>
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            Remarks
            <textarea
              rows={3}
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              placeholder="Optional note for the receiving office"
            />
          </label>
          <div className="form-actions span-2">
            <button type="button" className="secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Forwarding…' : 'Forward document'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
