import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MyWorkScreen } from '../src/features/documents/my-work-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentItem } from './fixtures';
import { calledPath } from './mock-api';
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

afterEach(() => {
  vi.clearAllMocks();
});

describe('MyWorkScreen', () => {
  it('lists the queue the server assigned to this user', async () => {
    apiMock.mockResolvedValue([
      documentItem(),
      documentItem({ id: 'doc-2', title: 'Second item' }),
    ]);
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
    apiMock.mockResolvedValue([documentItem({ status: 'IN_PROCESS', presentedStatus: 'PENDING' })]);
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.getByText('En route')).toBeInTheDocument();
    expect(screen.queryByText('In process')).not.toBeInTheDocument();
  });

  it('counts the queue beside the heading', async () => {
    apiMock.mockResolvedValue([documentItem(), documentItem({ id: 'doc-2' })]);
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
    apiMock.mockResolvedValue([]);
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
    apiMock.mockResolvedValue([documentItem()]);
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
    apiMock.mockResolvedValue([
      documentItem({ dueAt: past }),
      documentItem({ id: 'doc-2', title: 'Released late', status: 'RELEASED', dueAt: past }),
    ]);
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    const [late, closed] = document.querySelectorAll('[data-slot="work-row"]');
    expect(late).toHaveClass('border-destructive');
    expect(late).toHaveTextContent('3 days overdue');
    expect(closed).not.toHaveClass('border-destructive');
  });

  // The endpoint returns the whole queue, so the pager must say so rather than imply a window
  // the server never applied.
  it('reports one page of everything, with paging disabled', async () => {
    apiMock.mockResolvedValue([documentItem(), documentItem({ id: 'doc-2' })]);
    renderWithQuery(<MyWorkScreen />);

    await waitFor(() => expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument());
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });
});
