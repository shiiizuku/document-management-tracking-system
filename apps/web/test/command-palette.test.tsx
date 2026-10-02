import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@dts/contracts';
import { CommandPalette, openDocumentId } from '../src/features/command-palette/command-palette';
import type * as ApiModule from '../src/lib/api';
import { calledPath } from './mock-api';
import { documentDetail, documentItem, sessionUser } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock, toastSuccess, toastError } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

/** Which route the palette believes it is on. Set per test before rendering. */
let pathname = '/dashboard';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

/**
 * Answers every request the palette can make from one place: the session probe, the open
 * document, and the capped search. Routing by path rather than by call order, because the palette
 * fires them as the user types rather than in a fixed sequence.
 */
const serve = ({
  capabilities = ['REPORT_VIEW'] as Capability[],
  matches = [documentItem()],
  detail = documentDetail(),
}: {
  capabilities?: Capability[];
  matches?: ReturnType<typeof documentItem>[];
  detail?: ReturnType<typeof documentDetail>;
} = {}) => {
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser({ capabilities }));
    if (path.startsWith('/documents?'))
      return Promise.resolve({ items: matches, total: matches.length, page: 1, pageSize: 6 });
    if (path.startsWith('/documents/')) return Promise.resolve(detail);
    return Promise.reject(new Error(`unexpected request: ${path}`));
  });
};

/** Opens the palette with the chord, as a user would, and waits for the input to take focus. */
const openWithKeyboard = async () => {
  await userEvent.keyboard('{Meta>}k{/Meta}');
  return waitFor(() => screen.getByPlaceholderText(/Search documents, actions and screens/));
};

const typeInPalette = async (term: string) => {
  const input = await openWithKeyboard();
  await userEvent.type(input, term);
};

beforeEach(() => {
  pathname = '/dashboard';
  serve();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('openDocumentId', () => {
  it('finds the document a detail route is showing', () => {
    expect(openDocumentId('/documents/doc-1')).toBe('doc-1');
  });

  // The registry is not a document, and neither is anything nested below one — a future
  // `/documents/doc-1/versions` must not be mistaken for the document itself.
  it('reports none anywhere else', () => {
    expect(openDocumentId('/documents')).toBeNull();
    expect(openDocumentId('/documents/doc-1/versions')).toBeNull();
    expect(openDocumentId('/dashboard')).toBeNull();
  });
});

describe('CommandPalette', () => {
  /*
   * D-99 permits a shortcut only where it is discoverable. The trigger is that discoverability:
   * the chord is written on a real button rather than left for the user to guess.
   */
  it('advertises the shortcut on a visible trigger', () => {
    renderWithQuery(<CommandPalette />);
    expect(
      screen.getByRole('button', { name: /Open the command palette \(Ctrl K\)/ }),
    ).toBeInTheDocument();
  });

  it('opens from the keyboard', async () => {
    renderWithQuery(<CommandPalette />);
    await openWithKeyboard();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('opens from the trigger as well, for anyone who does not know the chord', async () => {
    renderWithQuery(<CommandPalette />);
    await userEvent.click(screen.getByRole('button', { name: /Open the command palette/ }));
    expect(
      screen.getByPlaceholderText(/Search documents, actions and screens/),
    ).toBeInTheDocument();
  });

  it('closes again on a second press', async () => {
    renderWithQuery(<CommandPalette />);
    await openWithKeyboard();
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  // Only the destinations this user may reach, from the same table the sidebar renders.
  it('offers only the destinations the user is capable of', async () => {
    serve({ capabilities: ['DOCUMENT_CREATE'] });
    renderWithQuery(<CommandPalette />);
    await openWithKeyboard();

    await waitFor(() => expect(screen.getByRole('option', { name: 'Documents' })).toBeVisible());
    expect(screen.queryByRole('option', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('includes a gated destination for a user who holds the capability', async () => {
    serve({ capabilities: ['AUDIT_VIEW'] });
    renderWithQuery(<CommandPalette />);
    await openWithKeyboard();

    await waitFor(() => expect(screen.getByRole('option', { name: 'Audit trail' })).toBeVisible());
  });

  it('navigates to a destination that was chosen', async () => {
    renderWithQuery(<CommandPalette />);
    await openWithKeyboard();

    await userEvent.click(await screen.findByRole('option', { name: 'Dashboard' }));

    expect(pushMock).toHaveBeenCalledWith('/dashboard');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  /*
   * The plan's "jump to a tracking number". The search is the server's — scoped to what this user
   * may read — and capped, because the palette is asking which document is meant, not showing a view.
   */
  it('jumps to a document matched by tracking number', async () => {
    renderWithQuery(<CommandPalette />);
    await typeInPalette('DTS-2026');

    const row = await screen.findByRole('option', { name: /DTS-2026-000001/ });
    expect(calledPath(apiMock, (path) => path.includes('search=DTS-2026'))).toContain('pageSize=6');

    await userEvent.click(row);
    expect(pushMock).toHaveBeenCalledWith('/documents/doc-1');
  });

  // Two characters match almost every record, so a shorter term is not worth a request.
  it('does not search on a term too short to narrow anything', async () => {
    renderWithQuery(<CommandPalette />);
    await typeInPalette('D');

    await waitFor(() => expect(screen.getByText(/Keep typing to search documents/)).toBeVisible());
    expect(calledPath(apiMock, (path) => path.startsWith('/documents?'))).toBeUndefined();
  });

  it('falls back to the full registry when a match is not in the shortlist', async () => {
    renderWithQuery(<CommandPalette />);
    await typeInPalette('budget letter');

    await userEvent.click(
      await screen.findByRole('option', { name: /Search the registry for “budget letter”/ }),
    );
    expect(pushMock).toHaveBeenCalledWith('/documents?search=budget%20letter');
  });

  describe('on a document', () => {
    beforeEach(() => {
      pathname = '/documents/doc-1';
    });

    /*
     * The actions are the server's `allowedActions` for this document and this actor, exactly as
     * the action bar renders them — the palette computes nothing of its own from the status.
     */
    it('offers the actions the server allowed on the open document', async () => {
      serve({ detail: documentDetail({ allowedActions: ['ACCEPT', 'ARCHIVE'] }) });
      renderWithQuery(<CommandPalette />);
      await openWithKeyboard();

      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Accept custody' })).toBeVisible(),
      );
      expect(screen.getByRole('option', { name: 'Archive' })).toBeVisible();
      expect(screen.queryByRole('option', { name: /Release document/ })).not.toBeInTheDocument();
    });

    it('offers no actions on a route that is not a document', async () => {
      pathname = '/reports';
      renderWithQuery(<CommandPalette />);
      await openWithKeyboard();

      await waitFor(() => expect(screen.getByRole('option', { name: 'Reports' })).toBeVisible());
      expect(screen.queryByRole('option', { name: 'Accept custody' })).not.toBeInTheDocument();
    });

    it('runs an action that needs no input, with the version it was shown', async () => {
      serve({ detail: documentDetail({ version: 3, allowedActions: ['ACCEPT'] }) });
      renderWithQuery(<CommandPalette />);
      await openWithKeyboard();

      await userEvent.click(await screen.findByRole('option', { name: 'Accept custody' }));

      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/ACCEPT', {
          method: 'POST',
          body: JSON.stringify({ expectedVersion: 3 }),
        }),
      );
      expect(toastSuccess).toHaveBeenCalled();
    });

    /*
     * An action that needs something typed is the reason the palette shares `useActionRunner`
     * rather than posting the command itself: the palette closes and the runner's own dialog takes
     * over, so the input and its validation exist in one place for both surfaces.
     */
    it('hands an action that needs input to the same dialog the action bar uses', async () => {
      serve({ detail: documentDetail({ allowedActions: ['REQUEST_REVISION'] }) });
      renderWithQuery(<CommandPalette />);
      await openWithKeyboard();

      await userEvent.click(await screen.findByRole('option', { name: 'Request revision' }));

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByRole('button', { name: 'Request revision' })).toBeDisabled();

      await userEvent.type(screen.getByLabelText('Remarks'), 'Signature block is missing.');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Request revision' }));

      await waitFor(() =>
        expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/actions/REQUEST_REVISION', {
          method: 'POST',
          body: JSON.stringify({
            expectedVersion: 3,
            remarks: 'Signature block is missing.',
          }),
        }),
      );
    });

    it('narrows the actions by what has been typed', async () => {
      serve({
        detail: documentDetail({ allowedActions: ['ACCEPT', 'ARCHIVE'] }),
        matches: [],
      });
      renderWithQuery(<CommandPalette />);
      await typeInPalette('archive');

      await waitFor(() => expect(screen.getByRole('option', { name: 'Archive' })).toBeVisible());
      expect(screen.queryByRole('option', { name: 'Accept custody' })).not.toBeInTheDocument();
    });
  });
});
