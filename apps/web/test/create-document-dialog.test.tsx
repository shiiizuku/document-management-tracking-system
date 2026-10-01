import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateDocumentDialog } from '../src/features/documents/create-document-dialog';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentItem, sessionUser } from './fixtures';
import { requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock } = vi.hoisted(() => ({ apiMock: vi.fn(), pushMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const divisions = [
  { id: 'division-1', code: 'D1', name: 'Records Division', active: true },
  { id: 'division-2', code: 'D2', name: 'Legal Division', active: true },
];

const serve = (onCreate: () => Promise<unknown>) =>
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
    if (path === '/divisions') return Promise.resolve(divisions);
    if (path.startsWith('/sections')) return Promise.resolve([]);
    return onCreate();
  });

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: /Register document/ }));
  return screen.getByRole('dialog');
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('CreateDocumentDialog', () => {
  it('registers a document and opens the new record', async () => {
    serve(() => Promise.resolve(documentItem()));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Quarterly submission');
    await userEvent.type(screen.getByLabelText('Sender'), 'Regional Office');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/documents/doc-1'));
    expect(requestBody(apiMock, '/documents')).toMatchObject({
      title: 'Quarterly submission',
      sender: 'Regional Office',
      direction: 'INCOMING',
    });
  });

  // The tracking number is the server's to assign, and is what the user needs next — to write on
  // the physical document, or to attach the scan to.
  it('defaults the placement to the registrar’s own division', async () => {
    serve(() => Promise.resolve(documentItem()));
    renderWithQuery(<CreateDocumentDialog />);
    await open();

    await waitFor(() =>
      expect(screen.getByLabelText('Division')).toHaveTextContent('Records Division'),
    );
  });

  /*
   * The conditional rule the server enforces, applied by the same schema in the browser: an
   * incoming document has to name who sent it.
   */
  it('refuses an incoming document with no sender, without calling the API', async () => {
    serve(() => Promise.resolve(documentItem()));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Unsourced letter');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));

    await waitFor(() =>
      expect(screen.getByText('Sender is required for incoming documents')).toBeInTheDocument(),
    );
    expect(apiMock).not.toHaveBeenCalledWith('/documents', expect.anything());
  });

  it('accepts an outgoing document with no sender', async () => {
    serve(() => Promise.resolve(documentItem({ direction: 'OUTGOING' })));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Outgoing memorandum');
    await userEvent.click(screen.getByLabelText('Direction'));
    await userEvent.click(screen.getByRole('option', { name: 'Outgoing' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/documents/doc-1'));
    expect(requestBody(apiMock, '/documents')).toMatchObject({ direction: 'OUTGOING' });
  });

  it('puts a server-rejected field back on its own input', async () => {
    serve(() =>
      Promise.reject(
        new ApiError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { fieldErrors: { referenceNumber: ['Already used by another document'] } },
        }),
      ),
    );
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Quarterly submission');
    await userEvent.type(screen.getByLabelText('Sender'), 'Regional Office');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));

    await waitFor(() =>
      expect(screen.getByText('Already used by another document')).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
