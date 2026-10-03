import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentActions } from '../src/features/documents/document-actions';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, toastSuccess, toastError } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

afterEach(() => {
  vi.clearAllMocks();
});

/*
 * Release methods are configured rows served by `GET /release-methods` (policy register P-15), so
 * the release dialog cannot be driven without them. Two are enough: one that takes no tracking
 * reference and one that requires one.
 */
const RELEASE_METHODS = [
  { id: 'rm-1', code: 'POSTAL', label: 'Postal', requiresTrackingReference: false },
  { id: 'rm-2', code: 'LBC', label: 'LBC', requiresTrackingReference: true },
];

/**
 * Answers `/release-methods` with that list and everything else with `fallback`.
 *
 * The blunt `mockResolvedValue` the other cases use would hand the method list to the picker as a
 * document, so the release cases need the mock to know which call it is answering.
 */
const withReleaseMethods = (fallback: unknown) => {
  apiMock.mockImplementation((path: string) =>
    Promise.resolve(path === '/release-methods' ? RELEASE_METHODS : fallback),
  );
};

describe('DocumentActions', () => {
  // The server computes `allowedActions` from the workflow state and the actor's capabilities.
  // Rendering anything else would offer a control the API is going to refuse.
  it('renders exactly the actions the server allowed', () => {
    renderWithQuery(
      <DocumentActions document={documentDetail({ allowedActions: ['ACCEPT', 'ARCHIVE'] })} />,
    );

    expect(screen.getByRole('button', { name: 'Accept custody' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Release/ })).not.toBeInTheDocument();
  });

  it('says so when nothing is available', () => {
    renderWithQuery(<DocumentActions document={documentDetail({ allowedActions: [] })} />);
    expect(screen.getByText(/No workflow actions are available/)).toBeInTheDocument();
  });

  it('runs an action that needs no input straight away, with the version it was shown', async () => {
    apiMock.mockResolvedValue(documentDetail({ status: 'IN_PROCESS', version: 4 }));
    renderWithQuery(<DocumentActions document={documentDetail({ version: 3 })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Accept custody' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/ACCEPT', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  /*
   * Replaces `window.prompt`. Remarks are required for a revision request — the server enforces
   * it too — so the action cannot be submitted empty.
   */
  it('requires remarks before it will request a revision', async () => {
    renderWithQuery(
      <DocumentActions document={documentDetail({ allowedActions: ['REQUEST_REVISION'] })} />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Request revision' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Request revision' })).toBeDisabled();
    expect(apiMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Remarks'), 'Signature block is missing.');
    apiMock.mockResolvedValue(documentDetail({ status: 'FOR_REVISION' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request revision' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/REQUEST_REVISION', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3, remarks: 'Signature block is missing.' }),
      }),
    );
  });

  it('collects the delivery method before releasing', async () => {
    withReleaseMethods(documentDetail({ status: 'RELEASED' }));
    renderWithQuery(<DocumentActions document={documentDetail({ allowedActions: ['RELEASE'] })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Release document' }));
    await waitFor(() => expect(screen.getByLabelText('Delivery method')).toBeEnabled());
    await userEvent.click(screen.getByLabelText('Delivery method'));
    await userEvent.click(screen.getByRole('option', { name: 'Postal' }));

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Release document' }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/RELEASE', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3, releaseMethod: 'POSTAL' }),
      }),
    );
  });

  /*
   * Decision 27 as amended: a method may require a tracking reference, and then it is mandatory.
   * The requirement is a property of the chosen method, so the field appears on selecting a
   * courier and the submit stays disabled until it is filled.
   */
  it('demands a tracking reference for a courier, and sends it', async () => {
    withReleaseMethods(documentDetail({ status: 'RELEASED' }));
    renderWithQuery(<DocumentActions document={documentDetail({ allowedActions: ['RELEASE'] })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Release document' }));
    await waitFor(() => expect(screen.getByLabelText('Delivery method')).toBeEnabled());
    expect(screen.queryByLabelText(/tracking reference/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Delivery method'));
    await userEvent.click(screen.getByRole('option', { name: 'LBC' }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Release document' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('LBC tracking reference'), 'LBC-00042');
    await userEvent.click(dialog.getByRole('button', { name: 'Release document' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/RELEASE', {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: 3,
          releaseMethod: 'LBC',
          trackingReference: 'LBC-00042',
        }),
      }),
    );
  });

  /*
   * The stated behaviour for an optimistic-concurrency conflict: tell the user the document moved,
   * and let the refetch the mutation already triggered put the current version on screen. A blind
   * retry would be sent against a version that no longer exists.
   */
  it('reports a conflict as "changed — review and retry" rather than as a failure', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 409, code: 'DOCUMENT_CONFLICT', message: 'Version conflict' }),
    );
    renderWithQuery(<DocumentActions document={documentDetail()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Accept custody' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        'This document changed — review and retry',
        expect.anything(),
      ),
    );
  });

  it('reports any other failure with what the server said', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 422, code: 'RELEASE_BLOCKED', message: 'Attachment is not signed' }),
    );
    renderWithQuery(<DocumentActions document={documentDetail()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Accept custody' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Accept custody failed', {
        description: 'Attachment is not signed',
      }),
    );
  });
});
