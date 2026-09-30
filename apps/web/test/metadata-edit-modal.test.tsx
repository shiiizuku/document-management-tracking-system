import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataEditModal, type EditableDocument } from '../src/components/metadata-edit-modal';
import type * as DocumentsModule from '../src/lib/documents';

const { updateMock, revisionsMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  revisionsMock: vi.fn(),
}));

vi.mock('../src/lib/documents', async () => {
  const actual = await vi.importActual<typeof DocumentsModule>('../src/lib/documents');
  return { ...actual, updateMetadata: updateMock, fetchMetadataRevisions: revisionsMock };
});

const doc: EditableDocument = {
  id: 'd1',
  version: 3,
  title: 'Original title',
  type: 'MEMORANDUM',
  description: 'desc',
  priority: 'NORMAL',
  sender: 'Finance',
  company: null,
  referenceNumber: null,
  confidential: false,
};

afterEach(() => vi.clearAllMocks());

describe('MetadataEditModal', () => {
  it('sends only changed fields with the expected version', async () => {
    revisionsMock.mockResolvedValue([]);
    updateMock.mockResolvedValue({});
    const onSaved = vi.fn();
    render(<MetadataEditModal document={doc} onClose={() => undefined} onSaved={onSaved} />);

    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Revised title');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(updateMock).toHaveBeenCalledWith('d1', { expectedVersion: 3, title: 'Revised title' });
    expect(onSaved).toHaveBeenCalled();
  });

  it('refuses to save when nothing changed', async () => {
    revisionsMock.mockResolvedValue([]);
    render(
      <MetadataEditModal document={doc} onClose={() => undefined} onSaved={() => undefined} />,
    );
    await screen.findByLabelText('Title');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(await screen.findByText(/no changes to save/i)).toBeInTheDocument();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('renders the revision history with before → after', async () => {
    revisionsMock.mockResolvedValue([
      {
        id: 'r1',
        actorId: 'u1',
        before: { title: 'Original title' },
        after: { title: 'Revised title' },
        occurredAt: new Date().toISOString(),
      },
    ]);
    render(
      <MetadataEditModal document={doc} onClose={() => undefined} onSaved={() => undefined} />,
    );
    expect(await screen.findByText(/Original title → Revised title/)).toBeInTheDocument();
  });
});
