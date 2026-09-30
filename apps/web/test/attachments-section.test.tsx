import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentsSection } from '../src/components/attachments-section';
import type * as AttachmentsModule from '../src/lib/attachments';
import type { AttachmentGroup } from '../src/lib/attachments';

const { fetchMock, downloadMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  downloadMock: vi.fn(),
}));

vi.mock('../src/lib/attachments', async () => {
  const actual = await vi.importActual<typeof AttachmentsModule>('../src/lib/attachments');
  return { ...actual, fetchAttachments: fetchMock, downloadAttachment: downloadMock };
});

const group = (scanStatus: AttachmentGroup['versions'][number]['scanStatus']): AttachmentGroup => ({
  attachmentId: 'a1',
  versions: [
    {
      id: 'v1',
      attachmentId: 'a1',
      versionNumber: 1,
      originalName: 'budget.pdf',
      mediaType: 'application/pdf',
      sizeBytes: 2048,
      checksumSha256: 'abc',
      uploaderId: 'u1',
      uploadedAt: new Date().toISOString(),
      scanStatus,
      isCurrent: true,
      isSigned: false,
    },
  ],
});

afterEach(() => vi.clearAllMocks());

describe('AttachmentsSection', () => {
  it('shows a scan badge and blocks download until a version is clean', async () => {
    fetchMock.mockResolvedValue([group('PENDING')]);
    render(<AttachmentsSection documentId="doc-1" />);

    expect(await screen.findByText('budget.pdf')).toBeInTheDocument();
    expect(screen.getByText('Scan pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled();
  });

  it('enables download for a clean version', async () => {
    fetchMock.mockResolvedValue([group('CLEAN')]);
    render(<AttachmentsSection documentId="doc-1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled());
    expect(screen.getByText('Clean')).toBeInTheDocument();
  });

  it('renders the empty state when there are no attachments', async () => {
    fetchMock.mockResolvedValue([]);
    render(<AttachmentsSection documentId="doc-1" />);
    expect(await screen.findByText('No attachments yet.')).toBeInTheDocument();
  });
});
