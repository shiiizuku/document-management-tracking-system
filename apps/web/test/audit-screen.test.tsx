import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditScreen } from '../src/features/audit/audit-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { adminUser, auditEvent, auditPage, sessionUser } from './fixtures';
import { calledPath, calledPaths } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock, searchParams } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  searchParams: { current: new URLSearchParams() },
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
  useSearchParams: () => searchParams.current,
}));

/**
 * Serves each path the screen asks for. One implementation rather than a queue of resolved values,
 * because the screen fires three requests (session, trail, directory) whose order is not the
 * screen's decision to make.
 */
const serve = (
  options: {
    trail?: ReturnType<typeof auditPage> | Error;
    capabilities?: readonly string[];
  } = {},
) => {
  const trail = options.trail ?? auditPage([auditEvent()]);
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me')
      return Promise.resolve(
        sessionUser({
          capabilities: (options.capabilities ?? ['AUDIT_VIEW', 'USER_MANAGE']) as never,
        }),
      );
    if (path.startsWith('/users')) return Promise.resolve([adminUser()]);
    if (path.startsWith('/audit-events'))
      return trail instanceof Error ? Promise.reject(trail) : Promise.resolve(trail);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
};

afterEach(() => {
  vi.clearAllMocks();
  searchParams.current = new URLSearchParams();
});

/**
 * The filter panel is collapsed unless the screen arrives already filtered, so a test that drives
 * a filter has to open it the way a user would.
 */
const openAdvanced = () => userEvent.click(screen.getByRole('button', { name: /Advanced search/ }));

describe('AuditScreen', () => {
  it('lists recorded actions with the total the server counted', async () => {
    serve({ trail: auditPage([auditEvent()], 137) });
    renderWithQuery(<AuditScreen />);

    await waitFor(() => expect(screen.getByText('Document workflow · accept')).toBeInTheDocument());
    // The count beside the heading is the server's total, not the number of rows on screen — which
    // is the whole reason the endpoint reports one.
    expect(screen.getByText('137')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
  });

  // The trail stores a UUID so the reference survives a rename or a deactivation; the viewer is
  // where that becomes a name again.
  it('names the actor instead of showing the recorded id', async () => {
    serve();
    renderWithQuery(<AuditScreen />);

    await waitFor(() => expect(screen.getByText('Ana Dela Cruz')).toBeInTheDocument());
  });

  it('falls back to the recorded id when the name is not available', async () => {
    serve({ trail: auditPage([auditEvent({ actorId: 'user-nobody-knows' })]) });
    renderWithQuery(<AuditScreen />);

    await waitFor(() => expect(screen.getByText('user-nobody-knows')).toBeInTheDocument());
  });

  // A null actor is a recorded fact — a failed sign-in — not missing data.
  it('names an action with no authenticated actor as such', async () => {
    serve({ trail: auditPage([auditEvent({ actorId: null, action: 'auth.login' })]) });
    renderWithQuery(<AuditScreen />);

    await waitFor(() => expect(screen.getByText('Unauthenticated')).toBeInTheDocument());
  });

  it('does not ask for the directory when the user may not read it', async () => {
    serve({ capabilities: ['AUDIT_VIEW'] });
    renderWithQuery(<AuditScreen />);

    await waitFor(() => expect(screen.getByText('Document workflow · accept')).toBeInTheDocument());
    expect(calledPaths(apiMock).some((path) => path.startsWith('/users'))).toBe(false);
  });

  it('shows no rows and no empty state while loading', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<AuditScreen />);

    expect(screen.queryByText('Nothing has been recorded yet')).not.toBeInTheDocument();
  });

  it('explains an empty trail', async () => {
    serve({ trail: auditPage([]) });
    renderWithQuery(<AuditScreen />);

    await waitFor(() =>
      expect(screen.getByText('Nothing has been recorded yet')).toBeInTheDocument(),
    );
  });

  it('distinguishes an empty result from an empty trail when filtered', async () => {
    searchParams.current = new URLSearchParams('action=auth.login');
    serve({ trail: auditPage([]) });
    renderWithQuery(<AuditScreen />);

    await waitFor(() =>
      expect(screen.getByText('No recorded actions match these filters')).toBeInTheDocument(),
    );
  });

  it('reports a failed trail rather than an empty one', async () => {
    serve({
      trail: new ApiError({ status: 500, code: 'HTTP_500', message: 'Trail unavailable' }),
    });
    renderWithQuery(<AuditScreen />);

    await waitFor(() => expect(screen.getByText('Trail unavailable')).toBeInTheDocument());
    expect(screen.queryByText('Nothing has been recorded yet')).not.toBeInTheDocument();
  });

  it('puts a chosen date range in the URL so the finding can be linked', async () => {
    serve();
    renderWithQuery(<AuditScreen />);
    await openAdvanced();
    await waitFor(() => expect(screen.getByLabelText('From')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('From'), '2026-09-01');
    expect(pushMock).toHaveBeenCalledWith('/audit?from=2026-09-01', { scroll: false });
  });

  it('reads the filters it was linked with, and sends them to the API', async () => {
    searchParams.current = new URLSearchParams('action=auth.login&from=2026-09-01&page=2');
    serve();
    renderWithQuery(<AuditScreen />);

    await waitFor(() =>
      expect(calledPath(apiMock, (p) => p.startsWith('/audit-events'))).toBeDefined(),
    );
    const requested = calledPath(apiMock, (path) => path.startsWith('/audit-events')) ?? '';
    const query = new URLSearchParams(requested.split('?')[1]);
    expect(query.get('action')).toBe('auth.login');
    expect(query.get('from')).toBe('2026-09-01T00:00:00.000Z');
    expect(query.get('offset')).toBe('50');
  });

  it('opens a row for its correlation id and structured detail', async () => {
    serve();
    renderWithQuery(<AuditScreen />);
    // Waits for the resolved actor name, not merely for the row: the directory arrives in its own
    // request, and clicking before it lands would click a cell that is still showing the raw id.
    await waitFor(() =>
      expect(screen.getByRole('cell', { name: 'Ana Dela Cruz' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('cell', { name: 'Ana Dela Cruz' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('11111111-2222-4333-8444-555555555555');
    expect(dialog).toHaveTextContent('10.0.0.4');
    // The summary is shown verbatim: its keys differ per action, so labelling them would risk
    // mislabelling evidence.
    expect(dialog).toHaveTextContent('"toStatus": "IN_PROCESS"');
  });
});
