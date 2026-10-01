import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ScanStatus } from '@dts/contracts';
import { AttachmentsSection } from '../src/features/attachments/attachments-section';
import { formatBytes, isDownloadable, scanBadge } from '../src/features/attachments/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { attachmentGroup, attachmentVersion } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, downloadMock, uploadMock, toastError, toastSuccess } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  downloadMock: vi.fn(),
  uploadMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, download: downloadMock, upload: uploadMock };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

const serve = (groups: unknown) => apiMock.mockResolvedValue(groups);

afterEach(() => {
  vi.clearAllMocks();
});

describe('AttachmentsSection', () => {
  it('lists each version with its size and scan state', async () => {
    serve([attachmentGroup([attachmentVersion()])]);
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);

    await waitFor(() => expect(screen.getByText('budget.pdf')).toBeInTheDocument());
    expect(screen.getByText(/2.0 KB/)).toBeInTheDocument();
    expect(screen.getByText('Clean')).toBeInTheDocument();
    expect(screen.getByText('Current')).toBeInTheDocument();
  });

  it('explains an empty attachment list', async () => {
    serve([]);
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);

    await waitFor(() => expect(screen.getByText('No files attached')).toBeInTheDocument());
  });

  it('reports a failed list rather than showing it as empty', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 500, code: 'HTTP_500', message: 'Storage unavailable' }),
    );
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);

    await waitFor(() => expect(screen.getByText('Storage unavailable')).toBeInTheDocument());
    expect(screen.queryByText('No files attached')).not.toBeInTheDocument();
  });

  /*
   * The quarantine rule, from the user's side. The API fails closed on every download of a
   * version that is not CLEAN, so a download control beside a pending or infected file would
   * produce a refusal and teach people to ignore the badge next to it.
   */
  it.each([
    ['PENDING', 'Scan pending'],
    ['PENDING_RETRY', 'Scan retrying'],
    ['INFECTED', 'Infected'],
    ['SCAN_FAILED', 'Scan failed'],
  ] satisfies Array<[ScanStatus, string]>)(
    'offers no download for a %s version',
    async (scanStatus, label) => {
      serve([attachmentGroup([attachmentVersion({ scanStatus })])]);
      renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);

      await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    },
  );

  it('downloads a clean version through the transport, not a bare link', async () => {
    serve([attachmentGroup([attachmentVersion()])]);
    downloadMock.mockResolvedValue('budget.pdf');
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);
    await waitFor(() => expect(screen.getByText('budget.pdf')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Download/ }));

    await waitFor(() =>
      expect(downloadMock).toHaveBeenCalledWith(
        '/documents/doc-1/attachments/version-1/download',
        'budget.pdf',
      ),
    );
  });

  // A fail-closed refusal has to land beside the file, not as a navigation to an error page.
  it('reports a refused download without leaving the page', async () => {
    serve([attachmentGroup([attachmentVersion()])]);
    downloadMock.mockRejectedValue(
      new ApiError({ status: 409, code: 'FILE_NOT_CLEAN', message: 'File is not clean' }),
    );
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);
    await waitFor(() => expect(screen.getByText('budget.pdf')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Download/ }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Download refused', {
        description: 'File is not clean',
      }),
    );
  });

  it('shows the newest version first and marks the signed one', async () => {
    serve([
      attachmentGroup([
        attachmentVersion({ id: 'v1', versionNumber: 1, isCurrent: false, isSigned: true }),
        attachmentVersion({ id: 'v2', versionNumber: 2, isCurrent: true }),
      ]),
    ]);
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);

    await waitFor(() => expect(screen.getByText('Signed')).toBeInTheDocument());
    const versions = screen.getAllByText(/^v\d/);
    expect(versions[0]?.textContent).toContain('v2');
  });

  it('uploads the chosen file immediately', async () => {
    serve([]);
    uploadMock.mockResolvedValue(attachmentVersion());
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload />);
    await waitFor(() => expect(screen.getByText('No files attached')).toBeInTheDocument());

    const file = new File(['bytes'], 'scan.pdf', { type: 'application/pdf' });
    const input = document.querySelector('input[type="file"]');
    await userEvent.upload(input as HTMLInputElement, file);

    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    const [path, body] = uploadMock.mock.calls[0] as [string, FormData];
    expect(path).toBe('/documents/doc-1/attachments');
    expect((body.get('file') as File).name).toBe('scan.pdf');
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('offers no upload control to a user who may not edit the document', async () => {
    serve([attachmentGroup([attachmentVersion()])]);
    renderWithQuery(<AttachmentsSection documentId="doc-1" canUpload={false} />);

    await waitFor(() => expect(screen.getByText('budget.pdf')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Upload/ })).not.toBeInTheDocument();
  });
});

describe('scan state presentation', () => {
  it('clears only a clean scan for download', () => {
    expect(isDownloadable('CLEAN')).toBe(true);
    for (const status of ['PENDING', 'PENDING_RETRY', 'INFECTED', 'SCAN_FAILED'] as const) {
      expect(isDownloadable(status)).toBe(false);
    }
  });

  // "Will resolve itself" and "needs someone to act" must not look alike, or a stuck file is
  // mistaken for a slow one.
  it('distinguishes a transient scan state from a terminal one', () => {
    expect(scanBadge('PENDING_RETRY').variant).toBe('outline');
    expect(scanBadge('SCAN_FAILED').variant).toBe('destructive');
    expect(scanBadge('INFECTED').variant).toBe('destructive');
    expect(scanBadge('CLEAN').variant).toBe('secondary');
  });

  it.each([
    [512, '512 B'],
    [2048, '2.0 KB'],
    [1024 * 1024 * 3.5, '3.5 MB'],
    [1024 * 1024 * 42, '42 MB'],
  ])('formats %i bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});
