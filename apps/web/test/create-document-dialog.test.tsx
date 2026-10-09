import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateDocumentDialog } from '../src/features/documents/create-document-dialog';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentItem, documentTypes, sessionUser } from './fixtures';
import { calledPaths, requestBody } from './mock-api';
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
    if (path === '/document-types') return Promise.resolve(documentTypes());
    if (path.startsWith('/sections')) return Promise.resolve([]);
    if (path === '/office/head-of-bureau')
      return Promise.resolve({ name: 'Engr. Maria Santos', title: 'Regional Director' });
    if (path.startsWith('/documents/suggestions')) return Promise.resolve([]);
    return onCreate();
  });

/** Registering asks first; this answers the question the way a clerk who means it would. */
const confirmRegister = async () => {
  const confirm = await screen.findByRole('heading', { name: 'Register this document?' });
  const modal = confirm.closest('[role="dialog"]') as HTMLElement;
  await userEvent.click(within(modal).getByRole('button', { name: 'Register' }));
};

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
    await confirmRegister();

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

  it('sends an outgoing document in the Head of the Bureau’s name, to its recipients', async () => {
    serve(() => Promise.resolve(documentItem({ direction: 'OUTGOING' })));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Outgoing memorandum');
    await userEvent.click(screen.getByLabelText('Direction'));
    await userEvent.click(screen.getByRole('option', { name: 'Outgoing' }));

    // The sender is shown and cannot be typed over.
    const sender = await screen.findByDisplayValue('Engr. Maria Santos, Regional Director');
    expect(sender).toHaveAttribute('readonly');

    await userEvent.type(screen.getByLabelText('Recipient 1'), 'DENR Region III');
    await userEvent.click(screen.getByRole('button', { name: 'Add email address' }));
    await userEvent.type(screen.getByLabelText('Email 1 for recipient 1'), 'records@denr.gov.ph');
    await userEvent.click(screen.getByRole('button', { name: 'Add recipient' }));
    await userEvent.type(screen.getByLabelText('Recipient 2'), 'Provincial Governor');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));
    await confirmRegister();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/documents/doc-1'));
    expect(requestBody(apiMock, '/documents')).toMatchObject({
      direction: 'OUTGOING',
      recipients: [
        { name: 'DENR Region III', emails: ['records@denr.gov.ph'] },
        { name: 'Provincial Governor', emails: [] },
      ],
    });
  }, 20_000);

  it('treats an email row left empty as no email, not as an invalid one', async () => {
    serve(() => Promise.resolve(documentItem({ direction: 'OUTGOING' })));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Outgoing memorandum');
    await userEvent.click(screen.getByLabelText('Direction'));
    await userEvent.click(screen.getByRole('option', { name: 'Outgoing' }));
    await userEvent.type(screen.getByLabelText('Recipient 1'), 'DENR Region III');
    await userEvent.click(screen.getByRole('button', { name: 'Add email address' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));
    await confirmRegister();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/documents/doc-1'));
    expect(requestBody(apiMock, '/documents')).toMatchObject({
      recipients: [{ name: 'DENR Region III', emails: [] }],
    });
  }, 20_000);

  it('refuses an outgoing document with no recipient named', async () => {
    serve(() => Promise.resolve(documentItem({ direction: 'OUTGOING' })));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Outgoing memorandum');
    await userEvent.click(screen.getByLabelText('Direction'));
    await userEvent.click(screen.getByRole('option', { name: 'Outgoing' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));

    expect(await screen.findByText('Enter the recipient')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Register this document?' })).toBeNull();
    expect(calledPaths(apiMock)).not.toContain('/documents');
  });

  it('asks before registering, and sends nothing if the clerk declines', async () => {
    serve(() => Promise.resolve(documentItem()));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Quarterly submission');
    await userEvent.type(screen.getByLabelText('Sender'), 'Regional Office');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));

    const heading = await screen.findByRole('heading', { name: 'Register this document?' });
    const modal = heading.closest('[role="dialog"]') as HTMLElement;
    expect(within(modal).getByText('Quarterly submission')).toBeInTheDocument();
    await userEvent.click(within(modal).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Register this document?' })).toBeNull(),
    );
    expect(calledPaths(apiMock)).not.toContain('/documents');
  });

  it('puts a server-rejected field back on its own input', async () => {
    serve(() =>
      Promise.reject(
        new ApiError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { fieldErrors: { email: ['Enter a valid email address'] } },
        }),
      ),
    );
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Quarterly submission');
    await userEvent.type(screen.getByLabelText('Sender'), 'Regional Office');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));
    await confirmRegister();

    await waitFor(() =>
      expect(screen.getByText('Enter a valid email address')).toBeInTheDocument(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  /*
   * The optional fields sit in a collapsed panel, so they are not mounted when the form first
   * renders. Two things have to hold for a rejection on one of them to be visible at all: the
   * error must ATTACH to the field (which depends on the name being in `getValues()`, hence the
   * defaults), and the panel must OPEN by itself. The test above covers the first by finding the
   * message; this covers the second, because a dialog that silently refuses to save is the exact
   * failure the fold risks.
   */
  it('opens the collapsed panel holding a rejected field', async () => {
    serve(() =>
      Promise.reject(
        new ApiError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { fieldErrors: { email: ['Enter a valid email address'] } },
        }),
      ),
    );
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    // Shut to begin with: the email input is not even rendered.
    expect(screen.queryByLabelText(/Email address/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Title'), 'Quarterly submission');
    await userEvent.type(screen.getByLabelText('Sender'), 'Regional Office');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));
    await confirmRegister();

    await waitFor(() => expect(screen.getByLabelText(/Email address/)).toBeInTheDocument());
  });

  it('files a document without opening either optional panel', async () => {
    serve(() => Promise.resolve(documentItem()));
    renderWithQuery(<CreateDocumentDialog />);
    const dialog = await open();

    await userEvent.type(screen.getByLabelText('Title'), 'Quarterly submission');
    await userEvent.type(screen.getByLabelText('Sender'), 'Regional Office');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Register document' }));
    await confirmRegister();

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/documents/doc-1'));
    // The defaults the fold relies on are really sent, not dropped with the hidden inputs.
    expect(requestBody(apiMock, '/documents')).toMatchObject({
      priority: 'NORMAL',
      direction: 'INCOMING',
      type: 'MEMORANDUM',
    });
  });
});
