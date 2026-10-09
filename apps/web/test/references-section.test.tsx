import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetailScreen } from '../src/features/documents/document-detail-screen';
import { LINK_REFUSAL } from '../src/features/documents/references-section';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import {
  attachmentGroup,
  attachmentVersion,
  documentDetail,
  documentItem,
  referenceSummary,
  sessionUser,
} from './fixtures';
import { renderWithQuery } from './query-harness';

/**
 * Reference Documents on the detail screen (decisions 165–167, 178).
 *
 * The assertions that matter are the ones about what is *not* shown: a reader sees the references
 * their own payload holds and no trace of one it omits (decision 166), the Add control is absent
 * once the record is released (178), and both ways a link can fail produce the same words — a
 * target that does not exist and one outside the reader's scope arrive as identical 404s and must
 * leave as identical copy.
 */

const { apiMock, inlineMock, releaseMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  inlineMock: vi.fn(),
  releaseMock: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, download: vi.fn(), inlineContent: inlineMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/documents/doc-1',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const serve = (
  detail: ReturnType<typeof documentDetail>,
  options: { linkError?: Error; attachments?: unknown[]; candidates?: unknown[] } = {},
): void => {
  inlineMock.mockResolvedValue({
    url: 'blob:reference-1',
    mediaType: 'application/pdf',
    release: releaseMock,
  });
  apiMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
    if (path === '/documents/doc-1' && init?.method === undefined) return Promise.resolve(detail);
    if (path === '/documents/doc-1/references' && init?.method === 'POST')
      return options.linkError === undefined
        ? Promise.resolve(detail)
        : Promise.reject(options.linkError);
    if (path.endsWith('/attachments')) return Promise.resolve(options.attachments ?? []);
    if (path.startsWith('/documents?'))
      return Promise.resolve({
        items: options.candidates ?? [],
        total: (options.candidates ?? []).length,
        page: 1,
        pageSize: 6,
      });
    return Promise.resolve([]);
  });
};

const outgoing = (overrides: Parameters<typeof documentDetail>[0] = {}) =>
  documentDetail({ direction: 'OUTGOING', status: 'IN_PROCESS', ...overrides });

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReferencesSection', () => {
  it('lists exactly what the payload holds, and nothing standing in for what it omits', async () => {
    serve(outgoing({ referencedDocuments: [referenceSummary()] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Reference an incoming document')).toBeInTheDocument(),
    );
    expect(screen.getByText('Request for ore transport permits')).toBeInTheDocument();
    expect(screen.getByText('DTS-2026-000002')).toBeInTheDocument();
    // No count from another source, no "hidden" row: a second reference this reader may not read
    // is absent with nothing marking its place.
    expect(screen.queryByText(/hidden/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/of 2/)).not.toBeInTheDocument();
  });

  it('offers the Add control on an open outgoing document', async () => {
    serve(outgoing());
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Reference an incoming document')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Add reference' })).toBeInTheDocument();
  });

  it('withdraws the Add control once the document is released', async () => {
    serve(outgoing({ status: 'RELEASED' }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Reference an incoming document')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Add reference' })).not.toBeInTheDocument();
  });

  it('heads the incoming side Replies, and says nothing when there are none', async () => {
    serve(documentDetail({ replyDocuments: [referenceSummary({ direction: 'OUTGOING' })] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Replies')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Add reference' })).not.toBeInTheDocument();

    apiMock.mockClear();
    serve(documentDetail({ replyDocuments: [] }));
    const quiet = renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(within(quiet.container).queryByText('Replies')).not.toBeInTheDocument(),
    );
  });

  /*
   * Both misses are one message. The API answers an identical 404 for a target that does not exist
   * and one outside the reader's scope (decision 166); two different messages here would hand back
   * the existence oracle the API gives up.
   */
  /*
   * One case, not two, and that is the assertion. A target that does not exist and one outside
   * this reader's scope reach the browser as the same 404 with the same message — the API gives up
   * the difference on purpose (decision 166) — so the only way the UI could tell them apart is by
   * inventing it. What is pinned here is that a 404 produces the one shared refusal rather than
   * the server's wording, which a future change to that wording could make specific.
   */
  it('refuses a link it cannot make in words that describe both misses', async () => {
    const { toast } = await import('sonner');
    serve(outgoing(), {
      linkError: new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Document not found' }),
      candidates: [documentItem({ id: 'doc-9', trackingNumber: 'DTS-2026-000009' })],
    });
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(screen.getByText('Reference an incoming document')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add reference' }));
    await userEvent.type(screen.getByPlaceholderText('Search incoming documents'), 'budget');
    const option = await screen.findByText('DTS-2026-000009');
    await userEvent.click(option);

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Could not link that document', {
        description: LINK_REFUSAL,
      }),
    );
  });

  it('previews a reference attachment without nesting a dialog', async () => {
    serve(outgoing({ referencedDocuments: [referenceSummary()] }), {
      attachments: [attachmentGroup([attachmentVersion()])],
    });
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(screen.getByText('Reference an incoming document')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByText('Request for ore transport permits'));

    const dialogs = await screen.findAllByRole('dialog');
    expect(dialogs).toHaveLength(1);
    expect(within(dialogs[0]!).getByText('budget.pdf')).toBeInTheDocument();
    // The preview renders in this same modal rather than opening the attachment dialog, which is
    // itself a Dialog — a second one here would trap focus and close both on one Escape.
    expect(within(dialogs[0]!).queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
  });

  // An object URL is held by the document until it is revoked. `preview-dialog.tsx` already
  // guards this; the guard now lives in `InlineFilePane`, so it is asserted again at its second
  // caller rather than assumed to have come along.
  it('releases the previewed bytes when the reference modal closes', async () => {
    serve(outgoing({ referencedDocuments: [referenceSummary()] }), {
      attachments: [attachmentGroup([attachmentVersion()])],
    });
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(screen.getByText('Reference an incoming document')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByText('Request for ore transport permits'));
    await screen.findByTitle('Preview of budget.pdf');
    expect(releaseMock).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(releaseMock).toHaveBeenCalled());
  });
});
