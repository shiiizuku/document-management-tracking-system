import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetailScreen } from '../src/features/documents/document-detail-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail, mailMessage, sessionUser } from './fixtures';
import { calledWith, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

/** The release email on the detail screen: the section's gates, its rows, and the compose dialog. */

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, download: vi.fn(), inlineContent: vi.fn() };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/documents/doc-1',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Capabilities = ReturnType<typeof sessionUser>['capabilities'];

const RELEASER: Capabilities = ['DOCUMENT_EDIT', 'DOCUMENT_RELEASE'];

interface ServeOptions {
  messages?: ReturnType<typeof mailMessage>[];
  capabilities?: Capabilities;
  failWith?: Error;
}

const serve = (detail: ReturnType<typeof documentDetail>, options: ServeOptions = {}): void => {
  apiMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/auth/me')
      return Promise.resolve(sessionUser({ capabilities: options.capabilities ?? RELEASER }));
    if (path === '/documents/doc-1' && init?.method === undefined) return Promise.resolve(detail);
    if (path === '/documents/doc-1/mail' && init?.method === undefined)
      return Promise.resolve(options.messages ?? []);
    if (path.startsWith('/documents/doc-1/mail/') && init?.method !== undefined)
      return options.failWith === undefined
        ? Promise.resolve(mailMessage({ status: 'QUEUED' }))
        : Promise.reject(options.failWith);
    return Promise.resolve([]);
  });
};

const outgoing = (overrides: Parameters<typeof documentDetail>[0] = {}) =>
  documentDetail({ direction: 'OUTGOING', status: 'FOR_RELEASE', ...overrides });

const show = async (detail: ReturnType<typeof documentDetail>, options: ServeOptions = {}) => {
  serve(detail, options);
  renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
  await screen.findByRole('heading', { level: 1 });
  // The session settles after the document; the section's gate reads it.
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/auth/me'));
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('DocumentMailSection visibility', () => {
  it('is absent for an incoming document', async () => {
    await show(documentDetail({ status: 'FOR_RELEASE' }), { messages: [mailMessage()] });
    expect(screen.queryByRole('region', { name: 'Release email' })).not.toBeInTheDocument();
  });

  it('is absent for a reader without DOCUMENT_RELEASE', async () => {
    await show(outgoing(), { messages: [mailMessage()], capabilities: ['DOCUMENT_EDIT'] });
    expect(screen.queryByRole('region', { name: 'Release email' })).not.toBeInTheDocument();
  });

  it('is absent before the document is for release', async () => {
    await show(outgoing({ status: 'IN_PROCESS' }), { messages: [mailMessage()] });
    expect(screen.queryByRole('region', { name: 'Release email' })).not.toBeInTheDocument();
  });

  it('is shown once released, read-only after a send', async () => {
    await show(outgoing({ status: 'RELEASED' }), {
      messages: [mailMessage({ status: 'SENT', sentAt: '2026-09-03T08:00:00.000Z' })],
    });
    expect(await screen.findByRole('region', { name: 'Release email' })).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /compose|edit/i })).not.toBeInTheDocument();
  });
});

describe('Compose dialog', () => {
  const open = async (message = mailMessage()) => {
    await show(outgoing(), { messages: [message] });
    await userEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    return within(await screen.findByRole('dialog'));
  };

  it('is pre-filled from the draft, with the signed PDF as a read-only chip', async () => {
    const dialog = await open(mailMessage({ cc: ['cc@agency.gov.ph'] }));

    expect(dialog.getByText('records@agency.gov.ph')).toBeInTheDocument();
    // Cc is revealed because the draft has one; Bcc stays behind its toggle.
    expect(dialog.getByText('cc@agency.gov.ph')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Bcc' })).toBeInTheDocument();
    expect(dialog.getByLabelText('Subject')).toHaveValue('REF-9: Outgoing permit');
    expect(dialog.getByLabelText('Message')).toHaveValue('Good day.');
    expect(dialog.getByText('signed-permit.pdf')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('disables Send and says why when To is empty', async () => {
    const dialog = await open(mailMessage({ to: [] }));

    expect(dialog.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(dialog.getByText('Add a recipient')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('adds a chip on comma, lower-cases and de-duplicates, and refuses a bad address', async () => {
    const dialog = await open(mailMessage({ to: [] }));
    const to = dialog.getByLabelText('To');

    await userEvent.type(to, 'Chief@Agency.gov.ph,');
    await userEvent.type(to, 'chief@agency.gov.ph{Enter}');
    expect(dialog.getAllByText('chief@agency.gov.ph')).toHaveLength(1);
    expect(dialog.getByRole('button', { name: 'Send' })).toBeEnabled();

    await userEvent.type(to, 'not-an-address{Enter}');
    expect(dialog.getByText(/not a valid email/i)).toBeInTheDocument();
    expect(dialog.queryByText('not-an-address')).not.toBeInTheDocument();

    await userEvent.click(dialog.getByRole('button', { name: 'Remove chief@agency.gov.ph' }));
    expect(dialog.queryByText('chief@agency.gov.ph')).not.toBeInTheDocument();
  });

  it('adds a pending address on blur and reveals Bcc on request', async () => {
    const dialog = await open(mailMessage({ to: [] }));

    await userEvent.type(dialog.getByLabelText('To'), 'a@x.ph');
    await userEvent.click(dialog.getByRole('button', { name: 'Bcc' }));
    expect(dialog.getByText('a@x.ph')).toBeInTheDocument();
    expect(dialog.getByLabelText('Bcc')).toBeInTheDocument();
  });

  it('saves the edits, then sends', async () => {
    const dialog = await open();

    await userEvent.clear(dialog.getByLabelText('Subject'));
    await userEvent.type(dialog.getByLabelText('Subject'), 'New subject');
    await userEvent.click(dialog.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(calledWith(apiMock, 'POST', '/documents/doc-1/mail/mail-1/send')).toBe(true),
    );
    expect(requestBody(apiMock, '/documents/doc-1/mail/mail-1', 'PATCH')).toEqual({
      to: ['records@agency.gov.ph'],
      cc: [],
      bcc: [],
      subject: 'New subject',
      body: 'Good day.',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('saves a draft without sending', async () => {
    const dialog = await open();

    await userEvent.click(dialog.getByRole('button', { name: 'Save draft' }));

    await waitFor(() =>
      expect(calledWith(apiMock, 'PATCH', '/documents/doc-1/mail/mail-1')).toBe(true),
    );
    expect(calledWith(apiMock, 'POST', '/documents/doc-1/mail/mail-1/send')).toBe(false);
  });

  it('says mail is not configured when the server answers MAIL_NOT_CONFIGURED', async () => {
    await show(outgoing(), {
      messages: [mailMessage()],
      failWith: new ApiError({
        status: 422,
        code: 'MAIL_NOT_CONFIGURED',
        message: 'Outgoing mail is not configured on this server',
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    const dialog = within(await screen.findByRole('dialog'));

    await userEvent.click(dialog.getByRole('button', { name: 'Send' }));

    expect(await dialog.findByText('Mail is not configured')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Mail rows', () => {
  it('shows a failed message with its error and resends it', async () => {
    await show(outgoing(), {
      messages: [mailMessage({ status: 'FAILED', lastError: 'Connection refused', attempts: 5 })],
    });

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compose' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() =>
      expect(calledWith(apiMock, 'POST', '/documents/doc-1/mail/mail-1/resend')).toBe(true),
    );
  });

  it('lists the newest message first', async () => {
    await show(outgoing(), {
      messages: [
        mailMessage({
          id: 'old',
          subject: 'Older',
          status: 'FAILED',
          createdAt: '2026-09-01T00:00:00.000Z',
        }),
        mailMessage({
          id: 'new',
          subject: 'Newer',
          status: 'QUEUED',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
      ],
    });

    const region = await screen.findByRole('region', { name: 'Release email' });
    const rows = await within(region).findAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Newer');
    expect(rows[1]).toHaveTextContent('Older');
  });
});

describe('Skip mail', () => {
  it('requires remarks, then posts them', async () => {
    await show(outgoing(), { messages: [mailMessage()] });

    await userEvent.click(await screen.findByRole('button', { name: 'Skip mail' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByRole('button', { name: 'Skip mail' })).toBeDisabled();

    await userEvent.type(dialog.getByLabelText('Remarks'), 'Hand-delivered instead.');
    await userEvent.click(dialog.getByRole('button', { name: 'Skip mail' }));

    await waitFor(() =>
      expect(calledWith(apiMock, 'POST', '/documents/doc-1/mail/skip')).toBe(true),
    );
    expect(requestBody(apiMock, '/documents/doc-1/mail/skip')).toEqual({
      remarks: 'Hand-delivered instead.',
    });
  });

  it('is withdrawn once a message is sent, and the section says so', async () => {
    await show(outgoing(), {
      messages: [mailMessage({ status: 'SENT', sentAt: '2026-09-03T08:00:00.000Z' })],
    });

    expect(await screen.findByText(/mail was sent/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip mail' })).not.toBeInTheDocument();
  });

  it('is withdrawn once skipped, and the section says so', async () => {
    await show(outgoing(), {
      messages: [mailMessage({ skippedAt: '2026-09-03T08:00:00.000Z' })],
    });

    expect(await screen.findByText(/mail was skipped/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip mail' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compose' })).not.toBeInTheDocument();
  });
});
