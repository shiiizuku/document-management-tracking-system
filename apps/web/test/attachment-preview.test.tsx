import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachmentsSection } from '../src/features/attachments/attachments-section';
import { isPreviewable } from '../src/features/attachments/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { attachmentGroup, attachmentVersion } from './fixtures';
import { calledPaths } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, inlineMock, releaseMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  inlineMock: vi.fn(),
  releaseMock: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, inlineContent: inlineMock };
});

const servePdf = () =>
  inlineMock.mockResolvedValue({
    url: 'blob:preview-1',
    mediaType: 'application/pdf',
    release: releaseMock,
  });

const listOf = (...versions: ReturnType<typeof attachmentVersion>[]) =>
  apiMock.mockResolvedValue([attachmentGroup(versions)]);

afterEach(() => {
  vi.clearAllMocks();
});

describe('what may be previewed', () => {
  it('allows a clean PDF or image', () => {
    expect(isPreviewable(attachmentVersion({ mediaType: 'application/pdf' }))).toBe(true);
    expect(isPreviewable(attachmentVersion({ mediaType: 'image/png' }))).toBe(true);
  });

  // The quarantine rule is the same for a preview as for a download: a preview discloses the bytes
  // just as fully, so an uncleared scan blocks both.
  it('refuses anything the scanner has not cleared', () => {
    expect(isPreviewable(attachmentVersion({ scanStatus: 'PENDING' }))).toBe(false);
    expect(isPreviewable(attachmentVersion({ scanStatus: 'INFECTED' }))).toBe(false);
    expect(isPreviewable(attachmentVersion({ scanStatus: 'SCAN_FAILED' }))).toBe(false);
  });

  it('refuses a type the browser cannot render in place', () => {
    expect(isPreviewable(attachmentVersion({ mediaType: 'application/zip' }))).toBe(false);
  });
});

describe('AttachmentsSection preview control', () => {
  it('offers a preview beside the download for a clean file', async () => {
    listOf(attachmentVersion());
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);

    await waitFor(() => expect(screen.getByText('budget.pdf')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  // No control at all rather than a disabled one: the scan badge beside it already says why.
  it('offers no preview while the scan is pending', async () => {
    listOf(attachmentVersion({ scanStatus: 'PENDING' }));
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);

    await waitFor(() => expect(screen.getByText('Scan pending')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  it('fetches the inline content endpoint, not the download one', async () => {
    listOf(attachmentVersion());
    servePdf();
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    await waitFor(() =>
      expect(calledPaths(inlineMock)).toContain('/documents/doc-1/attachments/version-1/content'),
    );
    expect(calledPaths(apiMock)).not.toContain('/documents/doc-1/attachments/version-1/download');
  });

  /*
   * A document that arrived from outside the office is untrusted content, and rendering it is where
   * that matters: the frame carries no `allow-` tokens, so a crafted PDF has no scripting and an
   * opaque origin.
   */
  it('renders a PDF in an unsandboxed frame, which Chrome requires for its viewer', async () => {
    listOf(attachmentVersion());
    servePdf();
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const frame = await screen.findByTitle('Preview of budget.pdf');
    expect(frame).toHaveAttribute('src', 'blob:preview-1#toolbar=0&navpanes=0');
    expect(frame).not.toHaveAttribute('sandbox');
  });

  it('renders an image as an image rather than in a document frame', async () => {
    listOf(attachmentVersion({ originalName: 'scan.png', mediaType: 'image/png' }));
    inlineMock.mockResolvedValue({
      url: 'blob:preview-2',
      mediaType: 'image/png',
      release: releaseMock,
    });
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    const image = await screen.findByAltText('scan.png');
    expect(image).toHaveAttribute('src', 'blob:preview-2');
    expect(screen.queryByTitle('Preview of scan.png')).not.toBeInTheDocument();
  });

  // An object URL is held by the document until it is revoked, so a preview opened repeatedly would
  // otherwise keep every file in memory for the life of the tab.
  it('releases the fetched bytes when the preview is closed', async () => {
    listOf(attachmentVersion());
    servePdf();
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByTitle('Preview of budget.pdf');
    expect(releaseMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(releaseMock).toHaveBeenCalled());
  });

  it('says a preview failed instead of showing an empty frame', async () => {
    listOf(attachmentVersion());
    inlineMock.mockRejectedValue(
      new ApiError({
        status: 415,
        code: 'PREVIEW_UNSUPPORTED',
        message: 'This file type cannot be previewed in the browser',
      }),
    );
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));

    // The pane that renders this now serves the routing slip too, so its refusal is worded for
    // any inline file rather than for an attachment.
    expect(await screen.findByText('This file could not be shown')).toBeInTheDocument();
    expect(screen.queryByTitle('Preview of budget.pdf')).not.toBeInTheDocument();
  });
});
