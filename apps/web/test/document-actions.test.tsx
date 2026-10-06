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
 * the release dialog cannot be driven without them. Two are enough: one that takes no carrier, and
 * Mailed, which takes a carrier that requires a tracking reference.
 */
const RELEASE_METHODS = [
  { id: 'rm-1', code: 'EMAILED', label: 'Emailed', requiresCarrier: false, carriers: [] },
  {
    id: 'rm-2',
    code: 'MAILED',
    label: 'Mailed',
    requiresCarrier: true,
    carriers: [
      { id: 'rc-1', code: 'POSTAL', label: 'Postal', requiresTrackingReference: true },
      { id: 'rc-2', code: 'LBC', label: 'LBC', requiresTrackingReference: true },
    ],
  },
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

  /*
   * Decision 163: an incoming document terminates by being acted upon *with remarks*, and the
   * server refuses `COMPLY` without them (`COMPLY_REMARKS_REQUIRED`). This action was absent from
   * the runner's input table for a while, so the button sent an empty command and the only
   * outcome was a toast saying it failed — which made the terminal state of every incoming
   * document unreachable. The dialog is what closes that, so it is what this asserts.
   */
  it('collects the required remarks before recording compliance', async () => {
    renderWithQuery(<DocumentActions document={documentDetail({ allowedActions: ['COMPLY'] })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Record compliance' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Record compliance' })).toBeDisabled();
    expect(apiMock).not.toHaveBeenCalled();
    // Not the revision request's wording: the two actions both take remarks and mean different
    // things by them.
    expect(
      within(dialog).getByText(/Record what was done about this document/),
    ).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Remarks'), 'Certified copy issued.');
    apiMock.mockResolvedValue(documentDetail({ status: 'COMPLIED' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record compliance' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/COMPLY', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3, remarks: 'Certified copy issued.' }),
      }),
    );
  });

  // A copy's acknowledgement records that it was read; there is nothing to collect, so it is sent
  // on the first press, like accepting custody.
  it('acknowledges a copy without a dialog', async () => {
    renderWithQuery(
      <DocumentActions document={documentDetail({ allowedActions: ['ACKNOWLEDGE'] })} />,
    );
    apiMock.mockResolvedValue(documentDetail());

    await userEvent.click(screen.getByRole('button', { name: 'Acknowledge copy' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/ACKNOWLEDGE', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    );
  });

  it('collects the delivery method before releasing', async () => {
    withReleaseMethods(documentDetail({ status: 'RELEASED' }));
    renderWithQuery(<DocumentActions document={documentDetail({ allowedActions: ['RELEASE'] })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Release document' }));
    await waitFor(() => expect(screen.getByLabelText('Delivery method')).toBeEnabled());
    await userEvent.click(screen.getByLabelText('Delivery method'));
    await userEvent.click(screen.getByRole('option', { name: 'Emailed' }));
    expect(screen.queryByLabelText('Carrier')).not.toBeInTheDocument();

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Release document' }),
    );

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/RELEASE', {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: 3, releaseMethod: 'EMAILED' }),
      }),
    );
  });

  /*
   * P-15 as decided 2026-10-06: Mailed asks which carrier, with no default, and every carrier
   * requires a tracking reference. The submit stays disabled until both are given.
   */
  it('asks a mailed release for its carrier and tracking reference, and sends both', async () => {
    withReleaseMethods(documentDetail({ status: 'RELEASED' }));
    renderWithQuery(<DocumentActions document={documentDetail({ allowedActions: ['RELEASE'] })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Release document' }));
    await waitFor(() => expect(screen.getByLabelText('Delivery method')).toBeEnabled());

    await userEvent.click(screen.getByLabelText('Delivery method'));
    await userEvent.click(screen.getByRole('option', { name: 'Mailed' }));

    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Release document' })).toBeDisabled();
    expect(screen.queryByLabelText(/tracking reference/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Carrier'));
    await userEvent.click(screen.getByRole('option', { name: 'Postal' }));
    expect(dialog.getByRole('button', { name: 'Release document' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('Postal tracking reference'), 'RR123456789PH');
    await userEvent.click(dialog.getByRole('button', { name: 'Release document' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/RELEASE', {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: 3,
          releaseMethod: 'MAILED',
          releaseCarrier: 'POSTAL',
          trackingReference: 'RR123456789PH',
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
