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

const serve = (payload: DashboardSummary | Error) =>
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(sessionUser());
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
