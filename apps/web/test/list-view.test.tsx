import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RegistryScreen } from '../src/features/documents/registry-screen';
import {
  DEFAULT_LIST_VIEW,
  LIST_VIEW_STORAGE_KEY,
  readListView,
} from '../src/features/documents/list-view';
import type * as ApiModule from '../src/lib/api';
import { documentItem, sessionUser } from './fixtures';
import { renderWithQuery } from './query-harness';

/**
 * The List view control (decision 173).
 *
 * The two things worth pinning are the two the feature is actually made of: that all three views
 * say the same thing about a document, because they read one column array and a second copy would
 * drift; and that the choice is remembered per device without reaching the URL, because a filtered
 * registry link is sent to colleagues and must not carry the sender's layout preference with it.
 */

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

const serve = () => {
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
    if (path.startsWith('/documents?'))
      return Promise.resolve({ items: [documentItem()], total: 1, page: 1, pageSize: 20 });
    return Promise.resolve([]);
  });
};

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  searchParams.value = new URLSearchParams();
});

const choose = (label: string) => userEvent.click(screen.getByRole('radio', { name: label }));

describe('list view', () => {
  it('says the same thing about a document in all three views', async () => {
    serve();
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    // The table, which is the default.
    expect(screen.getByText(/DTS-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText('En route')).toBeInTheDocument();

    await choose('Cards');
    expect(screen.getByTestId('document-cards')).toBeInTheDocument();
    expect(screen.getByText(/DTS-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText('En route')).toBeInTheDocument();

    await choose('Lines');
    expect(screen.getByTestId('document-lines')).toBeInTheDocument();
    expect(screen.getByText(/DTS-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText('En route')).toBeInTheDocument();
  });

  it('switches views without touching the URL or refetching the page', async () => {
    serve();
    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    const requestsBefore = apiMock.mock.calls.length;

    await choose('Cards');

    expect(pushMock).not.toHaveBeenCalled();
    expect(apiMock.mock.calls.length).toBe(requestsBefore);
  });

  it('remembers the choice across a remount', async () => {
    serve();
    const first = renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    await choose('Lines');
    first.unmount();

    renderWithQuery(<RegistryScreen />);
    await waitFor(() => expect(screen.getByTestId('document-lines')).toBeInTheDocument());
  });

  it('falls back to the table on a stored value it does not recognise', () => {
    window.localStorage.setItem(LIST_VIEW_STORAGE_KEY, 'mosaic');
    expect(readListView()).toBe(DEFAULT_LIST_VIEW);
    expect(DEFAULT_LIST_VIEW).toBe('table');
  });
});
