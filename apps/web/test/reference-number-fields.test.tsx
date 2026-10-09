import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateDocumentDialog } from '../src/features/documents/create-document-dialog';
import { MetadataDialog } from '../src/features/documents/metadata-dialog';
import type * as ApiModule from '../src/lib/api';
import { division, documentDetail, section, sessionUser } from './fixtures';
import { requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

/**
 * The two strings that have shared one column (decisions 168, 169).
 *
 * An incoming document keeps the reference the sending office printed on its letter — free text,
 * and now enterable at registration rather than only by reopening the record afterwards. An
 * outgoing one carries the office's own identifier, allocated inside the create transaction, which
 * nobody may type. "External reference" was wrong about both: the outgoing one is not external and
 * the incoming one is not ours.
 */

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/documents',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const serve = () => {
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
    if (path === '/divisions') return Promise.resolve([division()]);
    if (path.startsWith('/divisions/')) return Promise.resolve([section()]);
    if (path.startsWith('/documents/suggestions')) return Promise.resolve([]);
    if (path === '/office/head-of-bureau')
      return Promise.resolve({ name: '', title: 'Regional Director' });
    if (path.startsWith('/documents/') && path.endsWith('/metadata'))
      return Promise.resolve(documentDetail());
    return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 });
  });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("the sender's reference at registration (168)", () => {
  it('offers the field on an incoming document and withdraws it on an outgoing one', async () => {
    serve();
    renderWithQuery(<CreateDocumentDialog />);
    await userEvent.click(screen.getByRole('button', { name: /Register/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Sender.s reference/)).toBeInTheDocument();

    // Switching to outgoing withdraws it: that document's reference is the server's to issue.
    await userEvent.click(within(dialog).getByLabelText('Direction'));
    await userEvent.click(await screen.findByRole('option', { name: 'Outgoing' }));
    await waitFor(() =>
      expect(within(dialog).queryByLabelText(/Sender.s reference/)).not.toBeInTheDocument(),
    );
  });
});

describe('the reference number in the metadata dialog (169)', () => {
  it("labels an incoming document's reference as the sender's, and lets it be typed", async () => {
    serve();
    renderWithQuery(<MetadataDialog document={documentDetail({ direction: 'INCOMING' })} />);
    await userEvent.click(screen.getByRole('button', { name: /Edit/i }));

    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText(/Sender.s reference/);
    expect(field).not.toHaveAttribute('readonly');
  });

  it("shows an outgoing document's own reference read-only, and never sends it back", async () => {
    serve();
    renderWithQuery(
      <MetadataDialog
        document={documentDetail({
          direction: 'OUTGOING',
          referenceNumber: 'ORD-2026-00014',
          title: 'Reply letter',
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Edit/i }));

    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Reference number');
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveValue('ORD-2026-00014');

    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Reply letter, revised');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/i }));

    // Omitted from the patch entirely, not sent back unchanged: the server refuses the field on an
    // outgoing document, so echoing the current value would turn every edit into a 400.
    await waitFor(() => {
      const body = requestBody(apiMock, '/documents/doc-1/metadata', 'PATCH');
      expect(Object.keys(body)).not.toContain('referenceNumber');
    });
  });

  it("offers an outgoing document's recipients instead of a sender, and sends no sender", async () => {
    serve();
    renderWithQuery(
      <MetadataDialog
        document={documentDetail({
          direction: 'OUTGOING',
          sender: 'Engr. Maria Santos, Regional Director',
          recipients: [{ name: 'DENR Region III', emails: [] }],
        })}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Edit/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Sender')).not.toBeInTheDocument();
    const recipient = within(dialog).getByLabelText('Recipient 1');
    expect(recipient).toHaveValue('DENR Region III');
    await userEvent.type(recipient, ' (ORD)');
    await userEvent.click(within(dialog).getByRole('button', { name: /Save/i }));

    await waitFor(() => {
      const body = requestBody(apiMock, '/documents/doc-1/metadata', 'PATCH');
      expect(Object.keys(body)).not.toContain('sender');
      expect(body.recipients).toEqual([{ name: 'DENR Region III (ORD)', emails: [] }]);
    });
  });
});
