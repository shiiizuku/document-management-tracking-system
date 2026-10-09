import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyWorkScreen } from '../src/features/documents/my-work-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentItem } from './fixtures';
import { calledPath, calledPaths } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock } = vi.hoisted(() => ({ apiMock: vi.fn(), pushMock: vi.fn() }));

// Every request in this file answers with one fixture, so the type list the labels come from is
// stubbed to the code-derived fallback rather than fed the fixture.
vi.mock('../src/features/org/queries', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/features/org/queries');
  const { documentTypeLabel } = await vi.importActual<{
    documentTypeLabel: (code: string) => string;
  }>('../src/components/dts/status-badge');
  return { ...actual, useDocumentTypeLabel: () => documentTypeLabel };
});

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

/** One page of the queue, as `GET /documents/assigned` sends it. */
const queuePage = (
  items: unknown[],
  extra: { total?: number; nextCursor?: string | null } = {},
) => ({
  items,
  total: extra.total ?? items.length,
  nextCursor: extra.nextCursor ?? null,
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('MyWorkScreen', () => {
  it('lists the queue the server assigned to this user', async () => {
    apiMock.mockResolvedValue(
      queuePage([documentItem(), documentItem({ id: 'doc-2', title: 'Second item' })]),
    );
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.getByText('Second item')).toBeInTheDocument();
    expect(calledPath(apiMock, (path) => path === '/documents/assigned')).toBe(
      '/documents/assigned',
    );
  });

  // The stored status says In process for a document nobody has accepted yet; the row must show
  // what the detail page shows, or the same document reads two ways on two screens.
  it('badges a document awaiting acceptance as pending, not by its stored status', async () => {
    apiMock.mockResolvedValue(
      queuePage([documentItem({ status: 'IN_PROCESS', presentedStatus: 'PENDING' })]),
    );
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.getByText('En route')).toBeInTheDocument();
    expect(screen.queryByText('In process')).not.toBeInTheDocument();
  });

  it('counts the queue beside the heading', async () => {
    apiMock.mockResolvedValue(queuePage([documentItem(), documentItem({ id: 'doc-2' })]));
    renderWithQuery(<MyWorkScreen />);

    // The heading renders before the queue arrives, so the count is what has to be waited for.
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    expect(screen.getByText('My work')).toBeInTheDocument();
  });

  it('shows no rows and no empty state while loading', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<MyWorkScreen />);

    expect(screen.queryByText('Incoming budget letter')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing is assigned to you')).not.toBeInTheDocument();
  });

  it('explains an empty queue', async () => {
    apiMock.mockResolvedValue(queuePage([]));
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Nothing is assigned to you')).toBeInTheDocument());
  });

  it('reports a failed queue instead of an empty one', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 500, code: 'HTTP_500', message: 'Queue unavailable' }),
    );
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Queue unavailable')).toBeInTheDocument());
    expect(screen.queryByText('Nothing is assigned to you')).not.toBeInTheDocument();
  });

  it('opens an assigned document from its row', async () => {
    apiMock.mockResolvedValue(queuePage([documentItem()]));
    renderWithQuery(<MyWorkScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    // The title and the Open button are real links; the rest of the row opens it for a pointer.
    expect(screen.getByRole('link', { name: 'Incoming budget letter' })).toHaveAttribute(
      'href',
      '/documents/doc-1',
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/documents/doc-1');
    await userEvent.click(screen.getByText('En route'));
    expect(pushMock).toHaveBeenCalledWith('/documents/doc-1');
  });

  it('marks an open document past its target date, and not a closed one', async () => {
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    apiMock.mockResolvedValue(
      queuePage([
        documentItem({ dueAt: past }),
        documentItem({ id: 'doc-2', title: 'Released late', status: 'RELEASED', dueAt: past }),
      ]),
    );
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    const [late, closed] = document.querySelectorAll('[data-slot="work-row"]');
    expect(late).toHaveClass('border-destructive');
    expect(late).toHaveTextContent('3 days overdue');
    expect(closed).not.toHaveClass('border-destructive');
  });

  describe('continuous list', () => {
    const second = documentItem({ id: 'doc-2', title: 'Second page item' });

    const servePages = () =>
      apiMock.mockImplementation((path: string) =>
        Promise.resolve(
          path.includes('cursor=next-1')
            ? queuePage([second], { total: 2 })
            : queuePage([documentItem()], { total: 2, nextCursor: 'next-1' }),
        ),
      );

    it('loads the next page with the cursor and appends it, with no numbered pager', async () => {
      servePages();
      renderWithQuery(<MyWorkScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next page' })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Load more' }));

      await waitFor(() => expect(screen.getByText('Second page item')).toBeInTheDocument());
      expect(screen.getByText('Incoming budget letter')).toBeInTheDocument();
      expect(screen.getByText('Showing 2 of 2')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
      expect(calledPaths(apiMock).filter((path) => path.includes('cursor=next-1'))).toHaveLength(1);
    });

    // The count is the server's total for the whole queue, not how many rows have been loaded.
    it('counts the whole queue beside the heading while only the first page is loaded', async () => {
      servePages();
      renderWithQuery(<MyWorkScreen />);

      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('offers nothing more to load on a queue that fits one page', async () => {
      apiMock.mockResolvedValue(queuePage([documentItem()]));
      renderWithQuery(<MyWorkScreen />);
      await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

      expect(screen.getByText('Showing 1 of 1')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    });
  });
});
