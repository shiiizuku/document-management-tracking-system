import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetailScreen } from '../src/features/documents/document-detail-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail, mailMessage, sessionUser } from './fixtures';
import { mailRefetchInterval } from '../src/features/mail/queries';
import { calledPaths, calledRequests, calledWith, requestBody } from './mock-api';
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
  /** A function is read on every list request, so a test can change what the next poll sees. */
  messages?: ReturnType<typeof mailMessage>[] | (() => ReturnType<typeof mailMessage>[]);
  capabilities?: Capabilities;
  failWith?: Error;
  /** Fails the draft save only. */
  failPatch?: Error;
  /** Fails the send only. */
  failSend?: Error;
}

const serve = (detail: ReturnType<typeof documentDetail>, options: ServeOptions = {}): void => {
  apiMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/auth/me')
      return Promise.resolve(sessionUser({ capabilities: options.capabilities ?? RELEASER }));
    if (path === '/documents/doc-1' && init?.method === undefined) return Promise.resolve(detail);
    if (path === '/documents/doc-1/mail' && init?.method === undefined) {
      const { messages = [] } = options;
      return Promise.resolve(typeof messages === 'function' ? messages() : messages);
    }
    if (init?.method === 'PATCH')
      return options.failPatch === undefined
        ? Promise.resolve(mailMessage({ revision: 'rev-saved' }))
        : Promise.reject(options.failPatch);
    if (path.endsWith('/send') && options.failSend !== undefined)
      return Promise.reject(options.failSend);
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
    // The revision its own save returned, not the one the dialog was opened with.
    expect(requestBody(apiMock, '/documents/doc-1/mail/mail-1/send', 'POST')).toEqual({
      revision: 'rev-saved',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says so and reloads the stored draft when another save changed it before Send', async () => {
    let stored = mailMessage();
    await show(outgoing(), {
      messages: () => [stored],
      failSend: new ApiError({
        status: 409,
        code: 'MAIL_CHANGED',
        message: 'This message was changed since you opened it; review it again',
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    const dialog = within(await screen.findByRole('dialog'));
    // Someone else's save lands after this dialog opened.
    stored = mailMessage({ subject: 'Their subject', revision: 'rev-theirs' });

    await userEvent.click(dialog.getByRole('button', { name: 'Send' }));

    expect(
      await dialog.findByText('This message was changed since you opened it; review it again'),
    ).toBeInTheDocument();
    await waitFor(() => expect(dialog.getByLabelText('Subject')).toHaveValue('Their subject'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  /** The writes the dialog made, in order. */
  const writes = () => calledRequests(apiMock).filter((call) => !call.startsWith('GET '));

  it('adds a typed address and sends on one click: one PATCH, then one POST', async () => {
    const dialog = await open(mailMessage({ to: [] }));

    await userEvent.type(dialog.getByLabelText('To'), 'Chief@Agency.gov.ph');
    // Nothing committed the address yet, but Send counts what is typed.
    await userEvent.click(dialog.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(writes()).toEqual([
        'PATCH /documents/doc-1/mail/mail-1',
        'POST /documents/doc-1/mail/mail-1/send',
      ]),
    );
    expect(requestBody(apiMock, '/documents/doc-1/mail/mail-1', 'PATCH')).toMatchObject({
      to: ['chief@agency.gov.ph'],
    });
  });

  it('blocks Send and says why when the typed text is not an address', async () => {
    const dialog = await open();

    await userEvent.type(dialog.getByLabelText('To'), 'not-an-address');
    await userEvent.click(dialog.getByRole('button', { name: 'Send' }));

    expect(await dialog.findByText(/not-an-address is not a valid email/i)).toBeInTheDocument();
    expect(writes()).toEqual([]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not send when saving the draft fails', async () => {
    await show(outgoing(), {
      messages: [mailMessage()],
      failPatch: new ApiError({
        status: 409,
        code: 'MAIL_NOT_DRAFT',
        message: 'Only a draft can be edited',
      }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Compose' }));
    const dialog = within(await screen.findByRole('dialog'));

    await userEvent.click(dialog.getByRole('button', { name: 'Send' }));

    expect(await dialog.findByText('Only a draft can be edited')).toBeInTheDocument();
    expect(writes()).toEqual(['PATCH /documents/doc-1/mail/mail-1']);
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

  it('offers Resend only on the newest failure, and not once a later message is out', async () => {
    await show(outgoing(), {
      messages: [
        mailMessage({ id: 'first', status: 'FAILED', createdAt: '2026-09-01T00:00:00.000Z' }),
        mailMessage({ id: 'second', status: 'FAILED', createdAt: '2026-09-02T00:00:00.000Z' }),
      ],
    });
    const region = await screen.findByRole('region', { name: 'Release email' });
    await within(region).findAllByText('Failed');
    expect(within(region).getAllByRole('button', { name: 'Resend' })).toHaveLength(1);
    await userEvent.click(within(region).getByRole('button', { name: 'Resend' }));
    await waitFor(() =>
      expect(calledWith(apiMock, 'POST', '/documents/doc-1/mail/second/resend')).toBe(true),
    );
  });

  it('offers no Resend on a failure that a later sent message replaced', async () => {
    await show(outgoing(), {
      messages: [
        mailMessage({ id: 'old', status: 'FAILED', createdAt: '2026-09-01T00:00:00.000Z' }),
        mailMessage({
          id: 'new',
          status: 'SENT',
          sentAt: '2026-09-02T01:00:00.000Z',
          createdAt: '2026-09-02T00:00:00.000Z',
        }),
      ],
    });
    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resend' })).not.toBeInTheDocument();
  });

  it('offers no Compose on a draft once the document is no longer for release', async () => {
    await show(outgoing({ status: 'RELEASED' }), { messages: [mailMessage()] });
    expect(await screen.findByText('Draft')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Compose' })).not.toBeInTheDocument();
  });

  it('says why there is no message and that Emailed release is not blocked', async () => {
    await show(outgoing(), { messages: [] });
    const notice = await screen.findByText(/no release email was drafted/i);
    expect(notice).toHaveTextContent(/emailed release is not blocked/i);
    // A signed Word file or image drafts nothing either, so the reason names the PDF.
    expect(notice).toHaveTextContent(/no signed PDF/i);
    expect(screen.queryByRole('button', { name: 'Skip mail' })).not.toBeInTheDocument();
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

  it.each(['QUEUED', 'FAILED'] as const)(
    'is offered once Send left a %s message',
    async (status) => {
      await show(outgoing(), { messages: [mailMessage({ status })] });
      expect(await screen.findByRole('button', { name: 'Skip mail' })).toBeInTheDocument();
    },
  );

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

describe('Delivery status', () => {
  it('polls every 3 s while a message is queued, and not otherwise', () => {
    expect(mailRefetchInterval([mailMessage({ status: 'QUEUED' })])).toBe(3000);
    expect(mailRefetchInterval([mailMessage({ status: 'SENT' }), mailMessage()])).toBe(false);
    expect(mailRefetchInterval(undefined)).toBe(false);
  });

  it('shows a queued message turning sent without a reload, and refreshes the document', async () => {
    let status: ReturnType<typeof mailMessage>['status'] = 'QUEUED';
    await show(outgoing(), { messages: () => [mailMessage({ status })] });
    expect(await screen.findByText('Queued')).toBeInTheDocument();
    const documentReads = () =>
      calledPaths(apiMock).filter((path) => path === '/documents/doc-1').length;
    const before = documentReads();

    status = 'SENT';

    expect(await screen.findByText(/mail was sent/i, {}, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(documentReads()).toBeGreaterThan(before));
  }, 10_000);
});
