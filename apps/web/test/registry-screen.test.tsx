import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegistryScreen } from '../src/features/documents/registry-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentItem, sessionUser } from './fixtures';
import { calledPath, calledPaths } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock, searchParams } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  searchParams: { value: new URLSearchParams() },
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParams.value,
  usePathname: () => '/documents',
}));

/**
 * Answers both requests the screen makes — the session (for capability gating) and the registry
 * page — by path, so the order they resolve in cannot change what a test asserts.
 */
const serve = (page: { items: unknown[]; total: number } | Error) => {
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
    if (path.startsWith('/documents?')) {
      return page instanceof Error
        ? Promise.reject(page)
        : Promise.resolve({ ...page, page: 1, pageSize: 20 });
    }
    // `/divisions`, which fills the division select. An array, like the API sends.
    return Promise.resolve([]);
  });
};

afterEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
});

/**
 * The filter panel is collapsed unless the screen arrives already filtered, so a test that drives
 * a filter has to open it the way a user would.
 */
const openAdvanced = () => userEvent.click(screen.getByRole('button', { name: /Advanced search/ }));

describe('RegistryScreen', () => {
  it('lists a page of documents with its tracking number and status', async () => {
    serve({ items: [documentItem()], total: 1 });
    renderWithQuery(<RegistryScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.getByText(/DTS-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText('En route')).toBeInTheDocument();
  });

  it('badges a document awaiting acceptance as pending, not by its stored status', async () => {
    serve({
      items: [documentItem({ status: 'IN_PROCESS', presentedStatus: 'PENDING' })],
      total: 1,
    });
    renderWithQuery(<RegistryScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.getByText('En route')).toBeInTheDocument();
    expect(screen.queryByText('In process')).not.toBeInTheDocument();
  });

  it('shows no rows and no empty state while the first page loads', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<RegistryScreen />);

    expect(screen.queryByText('Incoming budget letter')).not.toBeInTheDocument();
    expect(screen.queryByText(/No accessible documents/)).not.toBeInTheDocument();
  });

  it('explains an empty registry', async () => {
    serve({ items: [], total: 0 });
    renderWithQuery(<RegistryScreen />);

    await waitFor(() =>
      expect(screen.getByText('No accessible documents yet')).toBeInTheDocument(),
    );
  });

  // "Nothing registered" and "nothing matched your filter" need different copy: the first is a
  // state of the system, the second is something the user can undo.
  it('says so differently when a filter matched nothing', async () => {
    searchParams.value = new URLSearchParams('status=ARCHIVED');
    serve({ items: [], total: 0 });
    renderWithQuery(<RegistryScreen />);

    await waitFor(() =>
      expect(screen.getByText('No documents match these filters')).toBeInTheDocument(),
    );
  });

  it('reports a failed load instead of an empty registry', async () => {
    serve(new ApiError({ status: 500, code: 'HTTP_500', message: 'Registry unavailable' }));
    renderWithQuery(<RegistryScreen />);

    await waitFor(() => expect(screen.getByText('Registry unavailable')).toBeInTheDocument());
    expect(screen.queryByText('No accessible documents yet')).not.toBeInTheDocument();
  });

  it('reads its filters from the URL and sends them to the API', async () => {
    searchParams.value = new URLSearchParams('status=PENDING&search=budget');
    serve({ items: [documentItem()], total: 40 });
    renderWithQuery(<RegistryScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    const requested = calledPath(apiMock, (path) => path.startsWith('/documents?'));
    expect(requested).toContain('status=PENDING');
    expect(requested).toContain('search=budget');
    // Continuous list: no position in the request, so the server pages by cursor.
    expect(requested).not.toContain('page=');
    // The applied search is shown in the box, so a filtered link does not look unfiltered.
    expect(screen.getByLabelText('Search')).toHaveValue('budget');
  });

  // Filter state lives in the URL, which is what makes a filtered view linkable and the back
  // button meaningful.
  it('puts a chosen filter in the URL rather than in local state', async () => {
    serve({ items: [documentItem()], total: 1 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await openAdvanced();
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(screen.getByRole('option', { name: 'En route' }));

    expect(pushMock).toHaveBeenCalledWith('/documents?status=PENDING', { scroll: false });
  });

  describe('section filter', () => {
    const DIVISION = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    const SECTION = '7a9c1e2f-3b4d-4c5e-8f6a-1b2c3d4e5f6a';

    const serveOrg = () => {
      apiMock.mockImplementation((path: string) => {
        if (path === '/auth/me') return Promise.resolve(sessionUser());
        if (path.startsWith('/documents?'))
          return Promise.resolve({ items: [documentItem()], total: 1, page: 1, pageSize: 20 });
        if (path === '/divisions')
          return Promise.resolve([
            { id: DIVISION, code: 'LANDS', name: 'Lands Division', active: true },
          ]);
        if (path.startsWith('/sections'))
          return Promise.resolve([
            {
              id: SECTION,
              divisionId: DIVISION,
              code: 'SURVEY',
              name: 'Survey Section',
              active: true,
            },
          ]);
        return Promise.resolve([]);
      });
    };

    it('offers no section until a division is chosen', async () => {
      serveOrg();
      renderWithQuery(<RegistryScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      await openAdvanced();
      expect(screen.queryByLabelText('Section')).not.toBeInTheDocument();
    });

    it('sends the division and section from the URL to the API', async () => {
      searchParams.value = new URLSearchParams(`divisionId=${DIVISION}&sectionId=${SECTION}`);
      serveOrg();
      renderWithQuery(<RegistryScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      const requested = calledPath(apiMock, (path) => path.startsWith('/documents?'));
      expect(requested).toContain(`divisionId=${DIVISION}`);
      expect(requested).toContain(`sectionId=${SECTION}`);
      await openAdvanced();
      expect(await screen.findByLabelText('Section')).toBeInTheDocument();
    });

    it('drops the section when the division changes', async () => {
      searchParams.value = new URLSearchParams(`divisionId=${DIVISION}&sectionId=${SECTION}`);
      serveOrg();
      renderWithQuery(<RegistryScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      await openAdvanced();
      await userEvent.click(await screen.findByLabelText('Currently with'));
      await userEvent.click(screen.getByRole('option', { name: 'Any division' }));

      expect(pushMock).toHaveBeenCalledWith('/documents', { scroll: false });
    });
  });

  describe('continuous list', () => {
    const second = documentItem({ id: 'doc-2', title: 'Second page letter' });

    const servePages = () =>
      apiMock.mockImplementation((path: string) => {
        if (path === '/auth/me') return Promise.resolve(sessionUser());
        if (path.startsWith('/documents?'))
          return Promise.resolve(
            path.includes('cursor=next-1')
              ? { items: [second], total: 2, page: 1, pageSize: 20, nextCursor: null }
              : { items: [documentItem()], total: 2, page: 1, pageSize: 20, nextCursor: 'next-1' },
          );
        return Promise.resolve([]);
      });

    it('loads the next page with the cursor and appends it, with no numbered pager', async () => {
      servePages();
      renderWithQuery(<RegistryScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

      await waitFor(() => expect(screen.getByText('Second page letter')).toBeInTheDocument());
      // The first page is still there: scrolling adds to the list instead of replacing it.
      expect(screen.getByText('Incoming budget letter')).toBeInTheDocument();
      expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
      expect(calledPaths(apiMock).filter((path) => path.includes('cursor=next-1'))).toHaveLength(1);
    });

    it('offers nothing more to load on a list that fits one page', async () => {
      serve({ items: [documentItem()], total: 1 });
      renderWithQuery(<RegistryScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });
  });

  it('returns to the first page when the filters change', async () => {
    searchParams.value = new URLSearchParams('page=3');
    serve({ items: [documentItem()], total: 100 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await openAdvanced();
    await userEvent.click(screen.getByLabelText('Priority'));
    await userEvent.click(screen.getByRole('option', { name: 'Urgent' }));

    expect(pushMock).toHaveBeenCalledWith('/documents?priority=URGENT', { scroll: false });
  });

  it('applies the free-text search only on submit', async () => {
    serve({ items: [documentItem()], total: 1 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search'), 'memo');
    expect(pushMock).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Search'), '{Enter}');
    expect(pushMock).toHaveBeenCalledWith('/documents?search=memo', { scroll: false });
  });

  // The dashboard's Overdue tile links here; the filter has a checkbox, a chip and a badge count.
  it('filters to overdue documents from the panel', async () => {
    serve({ items: [documentItem()], total: 1 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await openAdvanced();
    await userEvent.click(screen.getByLabelText('Overdue only'));
    expect(pushMock).toHaveBeenCalledWith('/documents?overdue=true', { scroll: false });
  });

  it('shows an overdue link as a chip, counts it, and sends it to the API', async () => {
    searchParams.value = new URLSearchParams('overdue=true&status=IN_PROCESS');
    serve({ items: [documentItem()], total: 1 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    expect(calledPath(apiMock, (path) => path.startsWith('/documents?'))).toContain('overdue=true');
    expect(screen.getByRole('button', { name: /Advanced search, 2 filters active/ })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Overdue' }));
    expect(pushMock).toHaveBeenCalledWith('/documents?status=IN_PROCESS', { scroll: false });
  });

  it('opens a document from its row', async () => {
    serve({ items: [documentItem()], total: 1 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    // The title is a real link (keyboard, middle-click), and the rest of the row opens it too.
    expect(screen.getByRole('link', { name: 'Incoming budget letter' })).toHaveAttribute(
      'href',
      '/documents/doc-1',
    );
    await userEvent.click(screen.getByText('En route'));
    expect(pushMock).toHaveBeenCalledWith('/documents/doc-1');
  });

  it('clears every filter at once', async () => {
    searchParams.value = new URLSearchParams('status=PENDING&search=budget');
    serve({ items: [], total: 0 });
    renderWithQuery(<RegistryScreen />);
    await waitFor(() =>
      expect(screen.getByText('No documents match these filters')).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(pushMock).toHaveBeenCalledWith('/documents', { scroll: false });
  });

  it('offers registration only to a user who may register', async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve(sessionUser({ capabilities: [] }));
      if (path === '/divisions' || path === '/document-types') return Promise.resolve([]);
      return Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 });
    });
    renderWithQuery(<RegistryScreen />);

    await waitFor(() =>
      expect(screen.getByText('No accessible documents yet')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Register document/ })).not.toBeInTheDocument();
  });
});
