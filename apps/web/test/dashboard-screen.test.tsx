import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardScreen } from '../src/features/dashboard/dashboard-screen';
import type { DashboardSummary } from '../src/features/dashboard/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { sessionUser } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
}));

const summary = (overrides: Partial<DashboardSummary> = {}): DashboardSummary => ({
  total: 16,
  byStatus: {
    PENDING: 5,
    IN_PROCESS: 3,
    FOR_REVISION: 1,
    FOR_INITIAL: 1,
    FOR_SIGNATURE: 2,
    SIGNED: 1,
    FOR_RELEASE: 1,
    RELEASED: 2,
    COMPLIED: 1,
    ARCHIVED: 1,
  },
  overdue: 2,
  pendingByDivision: [
    { divisionId: 'division-1', divisionName: 'Records Division', total: 3 },
    { divisionId: 'division-2', divisionName: 'Legal Division', total: 2 },
  ],
  recentActivity: [
    {
      id: 'event-1',
      documentId: 'doc-1',
      trackingNumber: 'DTS-2026-000001',
      title: 'Incoming budget letter',
      action: 'ACCEPT',
      fromStatus: 'PENDING',
      toStatus: 'IN_PROCESS',
      actorId: 'user-2',
      actorName: 'Ana Dela Cruz',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
    },
  ],
  ...overrides,
});

const serve = (
  payload: DashboardSummary | Error,
  assigned: { items: unknown[]; total: number; nextCursor: string | null } = {
    items: [],
    total: 0,
    nextCursor: null,
  },
) =>
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
    // The "Your move" strip reads the My work queue's total.
    if (path === '/documents/assigned') return Promise.resolve(assigned);
    return payload instanceof Error ? Promise.reject(payload) : Promise.resolve(payload);
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe('DashboardScreen', () => {
  it('shows the scoped totals the server computed', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText('Awaiting acceptance')).toBeInTheDocument());
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('16')).toBeInTheDocument();
  });

  /*
   * The point of the backend change. The old UI counted whichever page of rows happened to be
   * loaded, so "in progress" meant "in progress among these twenty". These come from the server.
   */
  it('counts work in flight across every unfinished status, not just IN_PROCESS', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    // 3 IN_PROCESS + 1 FOR_REVISION + 2 FOR_SIGNATURE + 1 FOR_RELEASE
    await waitFor(() => expect(screen.getByText('In progress')).toBeInTheDocument());
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  /*
   * A number nobody can click is a number nobody can check. Each tile links to the filtered list
   * that produced it, and the chart links to the same list narrowed by division.
   */
  it('links each figure to the list that produced it', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: /Awaiting acceptance/ })).toHaveAttribute(
        'href',
        '/documents?status=PENDING',
      ),
    );
    expect(screen.getByRole('link', { name: /Records Division/ })).toHaveAttribute(
      'href',
      '/documents?status=PENDING&divisionId=division-1',
    );
  });

  // Overdue included, now that the registry has the same overdue filter the tile counts with.
  it('makes every tile a link to its filtered list', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    const expected = {
      'Awaiting acceptance': '/documents?status=PENDING',
      'In progress': '/documents?status=IN_PROCESS',
      Overdue: '/documents?overdue=true',
      'All documents': '/documents',
    };
    await waitFor(() => expect(screen.getByText('Overdue')).toBeInTheDocument());
    for (const [label, href] of Object.entries(expected)) {
      expect(screen.getByRole('link', { name: new RegExp(`^${label}`) })).toHaveAttribute(
        'href',
        href,
      );
    }
  });

  it('shows the Your move strip with the size of the My work queue', async () => {
    serve(summary(), {
      items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      total: 3,
      nextCursor: null,
    });
    renderWithQuery(<DashboardScreen />);

    const strip = await screen.findByRole('region', { name: 'Your move' });
    expect(strip).toHaveTextContent('Your move: 3 documents are assigned to you.');
    expect(screen.getByRole('link', { name: 'Open my work' })).toHaveAttribute('href', '/my-work');
  });

  // The queue is paged and the strip loads only the first page: its count is the server's total for
  // the whole queue, so a queue longer than a page must not read as just the page.
  it('counts the whole queue in the Your move strip, not the page that was loaded', async () => {
    serve(summary(), { items: [{ id: 'a' }, { id: 'b' }], total: 57, nextCursor: 'next-1' });
    renderWithQuery(<DashboardScreen />);

    const strip = await screen.findByRole('region', { name: 'Your move' });
    expect(strip).toHaveTextContent('Your move: 57 documents are assigned to you.');
    expect(
      apiMock.mock.calls.filter(([path]) => String(path).startsWith('/documents/assigned')),
    ).toHaveLength(1);
  });

  it('hides the Your move strip when nothing is assigned', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText('Awaiting acceptance')).toBeInTheDocument());
    expect(screen.queryByRole('region', { name: 'Your move' })).not.toBeInTheDocument();
  });

  it('breaks the pending queue down by division', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText('Records Division')).toBeInTheDocument());
    expect(screen.getByText('Legal Division')).toBeInTheDocument();
  });

  it('lists recent activity with who acted and links to the document', async () => {
    serve(summary());
    renderWithQuery(<DashboardScreen />);

    await waitFor(() =>
      expect(screen.getByText(/Accept custody by Ana Dela Cruz/)).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /Incoming budget letter/ })).toHaveAttribute(
      'href',
      '/documents/doc-1',
    );
  });

  it('shows no figures while the summary is loading', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<DashboardScreen />);
    expect(screen.queryByText('Awaiting acceptance')).not.toBeInTheDocument();
  });

  it('explains an empty division chart and an empty feed separately', async () => {
    serve(summary({ pendingByDivision: [], recentActivity: [] }));
    renderWithQuery(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText('Nothing is waiting')).toBeInTheDocument());
    expect(screen.getByText('No activity yet')).toBeInTheDocument();
  });

  it('reports a failed summary and offers a retry', async () => {
    serve(new ApiError({ status: 500, code: 'HTTP_500', message: 'Summary unavailable' }));
    renderWithQuery(<DashboardScreen />);

    await waitFor(() => expect(screen.getByText('Summary unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
