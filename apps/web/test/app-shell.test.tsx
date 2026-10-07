import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Capability } from '@dts/contracts';
import { AppShell } from '../src/components/dts/app-shell';
import type * as ApiModule from '../src/lib/api';
import type { SessionUser } from '../src/features/session/queries';
import { renderWithQuery } from './query-harness';

const { apiMock, replaceMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/documents',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const sessionUser = (capabilities: Capability[]): SessionUser => ({
  id: 'u1',
  email: 'staff@dts.local',
  displayName: 'Ana Dela Cruz',
  role: 'STAFF_MEMBER',
  divisionId: 'div-1',
  sectionId: 'sec-1',
  capabilities,
  canAccessConfidential: false,
  active: true,
});

const renderShell = (capabilities: Capability[]) => {
  const user = sessionUser(capabilities);
  apiMock.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/divisions' ? [{ id: 'div-1', name: 'Records Division', code: 'RD' }] : user,
    ),
  );
  return renderWithQuery(
    <AppShell user={user}>
      <p>Route content</p>
    </AppShell>,
  );
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('AppShell', () => {
  it('renders the route inside the frame', async () => {
    renderShell([]);
    expect(screen.getByText('Route content')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument(),
    );
  });

  // The F0 acceptance condition: a capability-gated destination is absent, not disabled, for a
  // user who does not hold the capability.
  it('hides a gated destination from a user without the capability', async () => {
    renderShell(['DOCUMENT_CREATE']);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Documents' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
  });

  it('shows it to a user who does', async () => {
    renderShell(['REPORT_VIEW']);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument());
  });

  it('marks the open section as the current page', async () => {
    renderShell([]);
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Documents' })).toHaveAttribute(
        'aria-current',
        'page',
      ),
    );
  });

  it('identifies the signed-in user and signs them out', async () => {
    renderShell([]);
    apiMock.mockResolvedValueOnce(undefined);

    await userEvent.click(screen.getByRole('button', { name: /Ana Dela Cruz/ }));
    expect(screen.getByText('staff@dts.local')).toBeInTheDocument();
    expect(within(screen.getByRole('menu')).getByText('Staff member')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: /Sign out/ }));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('lets anyone change their own password from the account menu', async () => {
    renderShell([]);

    await userEvent.click(screen.getByRole('button', { name: /Ana Dela Cruz/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Change password/ }));

    expect(await screen.findByRole('dialog', { name: 'Change password' })).toBeVisible();
  });

  // The footer names the person and where they sit, with the division resolved from its id.
  it('shows the role and division under the name in the sidebar footer', async () => {
    renderShell([]);
    expect(await screen.findByText('Staff member · Records Division')).toBeInTheDocument();
  });

  // Two Search buttons (sidebar and narrow topbar) but one palette, so ⌘K opens one dialog.
  it('opens the one command palette from the sidebar Search button', async () => {
    renderShell([]);
    const [search] = screen.getAllByRole('button', { name: /Open the command palette/ });
    if (search === undefined) throw new Error('no Search button');
    await userEvent.click(search);
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('puts the theme picker and the bell in the sidebar footer', async () => {
    renderShell([]);
    const footer = await waitFor(() => {
      const element = document.querySelector('[data-slot="sidebar-footer"]');
      if (!(element instanceof HTMLElement)) throw new Error('no footer');
      return element;
    });
    expect(within(footer).getByRole('button', { name: /^Theme: / })).toBeInTheDocument();
    expect(within(footer).getByRole('button', { name: /^Notifications/ })).toBeInTheDocument();
  });
});
