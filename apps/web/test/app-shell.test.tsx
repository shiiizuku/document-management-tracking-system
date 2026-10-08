import type { ReactNode } from 'react';
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

const renderShell = (capabilities: Capability[], content: ReactNode = <p>Route content</p>) => {
  const user = sessionUser(capabilities);
  apiMock.mockImplementation((path: string) =>
    Promise.resolve(
      path === '/divisions' ? [{ id: 'div-1', name: 'Records Division', code: 'RD' }] : user,
    ),
  );
  return renderWithQuery(<AppShell user={user}>{content}</AppShell>);
};

/**
 * jsdom has no `matchMedia` and applies no CSS, so the `lg` breakpoint the shell reads in script is
 * answered here: every query matches on a "desktop" and none does on a "phone".
 */
const setViewport = (width: 'desktop' | 'phone') => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: width === 'desktop',
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
};

/** Seeds the remembered sidebar state the shell reads on mount. */
const startCollapsed = () => window.localStorage.setItem('dts.sidebar-collapsed', '1');

const TOPBAR_SEARCH = { name: 'Search documents, actions and screens' };

const sidebar = (): HTMLElement => {
  const element = document.querySelector('[data-slot="app-sidebar"]');
  if (!(element instanceof HTMLElement)) throw new Error('no sidebar');
  return element;
};

const collapseToggle = () => screen.getByRole('button', { name: /(Collapse|Expand) the sidebar/ });

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
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

  describe('collapsed sidebar', () => {
    it('moves search into a top bar when collapsed on a wide screen', async () => {
      setViewport('desktop');
      startCollapsed();
      renderShell([]);

      const search = await screen.findByRole('button', TOPBAR_SEARCH);
      expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
      expect(search.closest('[data-slot="app-desktop-topbar"]')).not.toBeNull();
      expect(collapseToggle()).toHaveAttribute('aria-expanded', 'false');
    });

    // One search entry point: the rail loses its Search button once the top bar has one.
    it('leaves no Search button in the collapsed sidebar', async () => {
      setViewport('desktop');
      startCollapsed();
      renderShell([]);

      await screen.findByRole('button', TOPBAR_SEARCH);
      expect(
        within(sidebar()).queryByRole('button', { name: /command palette|search/i }),
      ).not.toBeInTheDocument();
    });

    it('moves the brand, the bell and the account into the top bar', async () => {
      setViewport('desktop');
      startCollapsed();
      renderShell([]);

      await screen.findByRole('button', TOPBAR_SEARCH);
      const topbar = document.querySelector('[data-slot="app-desktop-topbar"]');
      if (!(topbar instanceof HTMLElement)) throw new Error('no top bar');
      expect(within(topbar).getByText('Document Tracking')).toBeInTheDocument();
      expect(within(topbar).getByRole('button', { name: /^Notifications/ })).toBeInTheDocument();
      expect(within(topbar).getByRole('button', { name: 'Ana Dela Cruz' })).toBeInTheDocument();
      expect(within(sidebar()).queryByRole('button', { name: /^Notifications/ })).toBeNull();
      expect(within(sidebar()).queryByRole('button', { name: 'Ana Dela Cruz' })).toBeNull();
      expect(within(sidebar()).queryByText('Document Tracking')).toBeNull();
      // The rail keeps the per-person appearance controls.
      expect(within(sidebar()).getByRole('button', { name: /^Theme: / })).toBeInTheDocument();
    });

    it('has no top bar while expanded, and search stays in the sidebar', async () => {
      setViewport('desktop');
      renderShell([]);

      await waitFor(() => expect(collapseToggle()).toHaveAttribute('aria-expanded', 'true'));
      expect(screen.queryByRole('button', TOPBAR_SEARCH)).not.toBeInTheDocument();
      expect(document.querySelector('[data-slot="app-desktop-topbar"]')).toBeNull();
      expect(
        within(sidebar()).getByRole('button', { name: /Open the command palette/ }),
      ).toBeInTheDocument();
    });

    // Below `lg` there is no permanent sidebar, so a remembered collapse changes nothing there.
    it('shows no top-bar search below the desktop breakpoint', async () => {
      setViewport('phone');
      startCollapsed();
      renderShell([]);

      await waitFor(() => expect(collapseToggle()).toHaveAttribute('aria-expanded', 'false'));
      expect(screen.queryByRole('button', TOPBAR_SEARCH)).not.toBeInTheDocument();
    });

    it('opens the one shared command palette from the top-bar search', async () => {
      setViewport('desktop');
      startCollapsed();
      renderShell([]);

      await userEvent.click(await screen.findByRole('button', TOPBAR_SEARCH));
      expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });

    it('labels every nav icon with a tooltip while collapsed', async () => {
      setViewport('desktop');
      startCollapsed();
      renderShell([]);

      await screen.findByRole('button', TOPBAR_SEARCH);
      await userEvent.hover(screen.getByRole('link', { name: 'Documents' }));
      expect(await screen.findByRole('tooltip', { name: 'Documents' })).toBeInTheDocument();
    });
  });

  describe('Ctrl/⌘B', () => {
    it('toggles the sidebar, and the toggle names the shortcut', async () => {
      setViewport('desktop');
      renderShell([]);
      await waitFor(() => expect(collapseToggle()).toHaveAttribute('aria-expanded', 'true'));
      expect(collapseToggle()).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B');

      await userEvent.keyboard('{Control>}b{/Control}');
      expect(collapseToggle()).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('button', TOPBAR_SEARCH)).toBeInTheDocument();
      expect(window.localStorage.getItem('dts.sidebar-collapsed')).toBe('1');

      await userEvent.keyboard('{Meta>}b{/Meta}');
      expect(collapseToggle()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.queryByRole('button', TOPBAR_SEARCH)).not.toBeInTheDocument();
    });

    it('leaves the chord to a field being typed in', async () => {
      setViewport('desktop');
      renderShell([], <input aria-label="Remarks" />);
      await waitFor(() => expect(collapseToggle()).toHaveAttribute('aria-expanded', 'true'));

      await userEvent.click(screen.getByRole('textbox', { name: 'Remarks' }));
      await userEvent.keyboard('{Control>}b{/Control}');
      expect(collapseToggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('does not take Ctrl+K from the palette', async () => {
      setViewport('desktop');
      renderShell([]);
      await waitFor(() => expect(collapseToggle()).toHaveAttribute('aria-expanded', 'true'));

      await userEvent.keyboard('{Control>}k{/Control}');
      expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument();
      // The open modal hides the shell from the accessibility tree, so look past that.
      expect(
        screen.getByRole('button', { name: 'Collapse the sidebar', hidden: true }),
      ).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
