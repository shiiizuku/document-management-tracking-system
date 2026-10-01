import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteDocumentDialog } from '../src/features/documents/delete-document-dialog';
import { DeletedDocumentsDialog } from '../src/features/documents/deleted-documents-dialog';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail, documentItem } from './fixtures';
import { calledPaths, calledWith, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock } = vi.hoisted(() => ({ apiMock: vi.fn(), pushMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('DeleteDocumentDialog', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    return screen.findByRole('dialog');
  };

  it('says the deletion is reversible, because it is', async () => {
    renderWithQuery(<DeleteDocumentDialog document={documentDetail()} />);

    const dialog = await open();
    expect(dialog).toHaveTextContent('This is reversible');
    expect(dialog).toHaveTextContent('DTS-2026-000001');
  });

  it('sends the version the user was looking at, so a stale delete is refused', async () => {
    apiMock.mockResolvedValue(documentItem());
    renderWithQuery(<DeleteDocumentDialog document={documentDetail({ version: 7 })} />);

    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }));

    await waitFor(() => expect(calledWith(apiMock, 'DELETE', '/documents/doc-1')).toBe(true));
    expect(requestBody(apiMock, '/documents/doc-1', 'DELETE')).toEqual({ expectedVersion: 7 });
  });

  // The detail route answers 404 for a deleted document, so staying on the page would show the
  // user an error about the thing they just successfully did.
  it('leaves the page it just removed', async () => {
    apiMock.mockResolvedValue(documentItem());
    renderWithQuery(<DeleteDocumentDialog document={documentDetail()} />);

    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/documents'));
  });

  it('stays put and says what happened when the document moved on first', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 409, code: 'STALE_VERSION', message: 'Version conflict' }),
    );
    renderWithQuery(<DeleteDocumentDialog document={documentDetail()} />);

    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete document' }));

    await waitFor(() => expect(pushMock).not.toHaveBeenCalled());
  });
});

describe('DeletedDocumentsDialog', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Deleted' }));
    return screen.findByRole('dialog');
  };

  // A deleted-items query on every visit to the registry would ask a question nobody on screen has.
  it('asks for nothing until it is opened', async () => {
    apiMock.mockResolvedValue([]);
    renderWithQuery(<DeletedDocumentsDialog />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deleted' })).toBeInTheDocument(),
    );
    expect(calledPaths(apiMock)).toHaveLength(0);

    await open();
    await waitFor(() => expect(calledPaths(apiMock)).toContain('/documents/deleted'));
  });

  it('explains an empty recovery list', async () => {
    apiMock.mockResolvedValue([]);
    renderWithQuery(<DeletedDocumentsDialog />);

    await open();
    expect(await screen.findByText('Nothing has been deleted')).toBeInTheDocument();
  });

  it('reports a failed list rather than an empty one', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Not permitted' }),
    );
    renderWithQuery(<DeletedDocumentsDialog />);

    await open();
    expect(await screen.findByText('Not permitted')).toBeInTheDocument();
    expect(screen.queryByText('Nothing has been deleted')).not.toBeInTheDocument();
  });

  /*
   * The point of the endpoint: a deleted row is invisible to every other read, so this list is the
   * only place the version that restore requires can come from. A restore sent with the wrong
   * version is a 409.
   */
  it('restores with the version this list reported', async () => {
    apiMock.mockImplementation((path: string) =>
      path === '/documents/deleted'
        ? Promise.resolve([documentItem({ version: 9 })])
        : Promise.resolve(documentItem()),
    );
    renderWithQuery(<DeletedDocumentsDialog />);

    await open();
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(calledPaths(apiMock)).toContain('/documents/doc-1/restore'));
    expect(requestBody(apiMock, '/documents/doc-1/restore')).toEqual({ expectedVersion: 9 });
  });

  it('keeps the dialog usable when a restore is refused', async () => {
    apiMock.mockImplementation((path: string) =>
      path === '/documents/deleted'
        ? Promise.resolve([documentItem()])
        : Promise.reject(
            new ApiError({ status: 409, code: 'STALE_VERSION', message: 'Version conflict' }),
          ),
    );
    renderWithQuery(<DeletedDocumentsDialog />);

    await open();
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).not.toBeDisabled());
    expect(screen.getByText('Incoming budget letter')).toBeInTheDocument();
  });
});
