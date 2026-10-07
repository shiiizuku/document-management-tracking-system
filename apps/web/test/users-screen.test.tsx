import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UsersScreen } from '../src/features/admin/users-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import type { RoleGrant } from '@dts/contracts';
import { DIVISION_ID, SECTION_ID, adminUser, division, section, sessionUser } from './fixtures';
import { calledPaths, calledWith, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const serve = (
  options: {
    users?: ReturnType<typeof adminUser>[] | Error;
    signedInId?: string;
    roles?: RoleGrant[] | Error;
  } = {},
) => {
  const roles = options.roles ?? ROLE_GRANTS;
  const users = options.users ?? [adminUser()];
  apiMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === '/auth/me')
      return Promise.resolve(
        sessionUser({
          id: options.signedInId ?? 'user-1',
          capabilities: ['USER_MANAGE'],
        }),
      );
    if (path === '/roles')
      return roles instanceof Error ? Promise.reject(roles) : Promise.resolve(roles);
    if (path === '/divisions') return Promise.resolve([division()]);
    if (path.startsWith('/sections')) return Promise.resolve([section()]);
    if (path.endsWith('/deactivate')) return Promise.resolve(adminUser({ active: false }));
    if (path.endsWith('/reactivate')) return Promise.resolve(adminUser({ active: true }));
    if (path.endsWith('/password')) return Promise.resolve(undefined);
    if (path === '/users' && init?.method === 'POST')
      return Promise.resolve(adminUser({ displayName: 'New Person' }));
    if (path.startsWith('/users'))
      return users instanceof Error ? Promise.reject(users) : Promise.resolve(users);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
};

/** Two rows of the role table, as `GET /roles` serves them. */
const ROLE_GRANTS: RoleGrant[] = [
  {
    role: 'STAFF_MEMBER',
    capabilities: ['DOCUMENT_CREATE', 'DOCUMENT_ACCEPT', 'DOCUMENT_COMPLY'],
    readsOfficeWide: false,
  },
  { role: 'VIEWER', capabilities: [], readsOfficeWide: false },
];

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * The filter panel is collapsed unless the screen arrives already filtered, so a test that drives
 * a filter has to open it the way a user would.
 */
const openAdvanced = () => userEvent.click(screen.getByRole('button', { name: /Advanced search/ }));

describe('UsersScreen', () => {
  it('lists accounts with their role and placement named', async () => {
    serve();
    renderWithQuery(<UsersScreen />);

    await waitFor(() => expect(screen.getByText('Ana Dela Cruz')).toBeInTheDocument());
    expect(screen.getByText('Staff member')).toBeInTheDocument();
    expect(screen.getByText('Records Division')).toBeInTheDocument();
  });

  // A lockout expires on its own; a deactivation does not. Conflating them has an administrator
  // reactivating an account that was never switched off.
  it('distinguishes a temporary lockout from a deactivated account', async () => {
    serve({ users: [adminUser({ active: true, locked: true })] });
    renderWithQuery(<UsersScreen />);

    await waitFor(() => expect(screen.getByText('Locked out')).toBeInTheDocument());
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('explains an empty result', async () => {
    serve({ users: [] });
    renderWithQuery(<UsersScreen />);

    await waitFor(() => expect(screen.getByText('No accounts match')).toBeInTheDocument());
  });

  it('reports a failed list rather than an empty one', async () => {
    serve({
      users: new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Not permitted' }),
    });
    renderWithQuery(<UsersScreen />);

    await waitFor(() => expect(screen.getByText('Not permitted')).toBeInTheDocument());
    expect(screen.queryByText('No accounts match')).not.toBeInTheDocument();
  });

  it('narrows the list on the server, not in the browser', async () => {
    serve();
    renderWithQuery(<UsersScreen />);
    await openAdvanced();
    await waitFor(() => expect(screen.getByLabelText('Search')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search'), 'ana');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(calledPaths(apiMock)).toContain('/users?search=ana'));
  });

  it('deactivates rather than deletes, because the audit trail still names the actor', async () => {
    serve();
    renderWithQuery(<UsersScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Deactivate' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(calledPaths(apiMock)).toContain('/users/user-2/deactivate'));
  });

  it('offers reactivation for an account that is switched off', async () => {
    serve({ users: [adminUser({ active: false })] });
    renderWithQuery(<UsersScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    await waitFor(() => expect(calledPaths(apiMock)).toContain('/users/user-2/reactivate'));
  });

  it("resets another person's password, checking the policy before asking the server", async () => {
    serve();
    renderWithQuery(<UsersScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('signed out everywhere');
    await userEvent.type(within(dialog).getByLabelText('New password'), 'short');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    expect(
      await within(dialog).findByText('Password must be at least 12 characters'),
    ).toBeVisible();
    expect(calledPaths(apiMock)).not.toContain('/users/user-2/password');

    await userEvent.clear(within(dialog).getByLabelText('New password'));
    await userEvent.type(within(dialog).getByLabelText('New password'), 'Fresh-Passw0rd-2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }));
    await waitFor(() =>
      expect(requestBody(apiMock, '/users/user-2/password', 'POST')).toEqual({
        password: 'Fresh-Passw0rd-2026',
      }),
    );
  });

  // Their own password goes through the account menu, which asks for the current one.
  it("offers no reset on the signed-in administrator's own row", async () => {
    serve({ users: [adminUser({ id: 'user-1' })], signedInId: 'user-1' });
    renderWithQuery(<UsersScreen />);
    await waitFor(() => expect(screen.getByText('Ana Dela Cruz')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });

  // The API would allow it. The result is a console that has locked out its only operator.
  it('will not let the signed-in administrator deactivate themselves', async () => {
    serve({ users: [adminUser({ id: 'user-1' })], signedInId: 'user-1' });
    renderWithQuery(<UsersScreen />);

    await waitFor(() => expect(screen.getByText('You')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
  });

  it('leaves the signed-in administrator their own role, and says why', async () => {
    serve({ users: [adminUser({ id: 'user-1' })], signedInId: 'user-1' });
    renderWithQuery(<UsersScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This is your own account');
    expect(within(dialog).getByLabelText('Role')).toBeDisabled();
  });

  it('sends only the fields the patch schema accepts, and no email', async () => {
    serve();
    renderWithQuery(<UsersScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Email')).not.toBeInTheDocument();

    await userEvent.clear(within(dialog).getByLabelText('Full name'));
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Ana D. Cruz');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(calledPaths(apiMock)).toContain('/users/user-2'));
    expect(requestBody(apiMock, '/users/user-2')).toEqual({
      displayName: 'Ana D. Cruz',
      role: 'STAFF_MEMBER',
      divisionId: DIVISION_ID,
      sectionId: SECTION_ID,
      canAccessConfidential: false,
    });
  });

  it('checks the password policy before asking the server', async () => {
    serve();
    renderWithQuery(<UsersScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add user' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add user' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'New Person');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'new@dts.local');
    await userEvent.type(within(dialog).getByLabelText('Initial password'), 'short');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Password must be at least 12 characters')).toBeInTheDocument();
    expect(calledWith(apiMock, 'POST', '/users')).toBe(false);
  });

  it('lists what the selected role grants, and follows the role as it changes', async () => {
    serve();
    renderWithQuery(<UsersScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    const staffGrants = await within(dialog).findByRole('group', {
      name: 'What Staff member grants',
    });
    expect(staffGrants).toHaveTextContent('Record as complied');
    expect(staffGrants).toHaveTextContent('Its own division or section');

    await userEvent.click(within(dialog).getByLabelText('Role'));
    await userEvent.click(screen.getByRole('option', { name: 'Viewer' }));
    const viewerGrants = within(dialog).getByRole('group', { name: 'What Viewer grants' });
    expect(viewerGrants).toHaveTextContent('Read only — takes no action on documents');
    expect(viewerGrants).not.toHaveTextContent('Record as complied');
  });

  it('still saves when the role table cannot be fetched', async () => {
    serve({ roles: new ApiError({ status: 403, code: 'HTTP_403', message: 'Forbidden' }) });
    renderWithQuery(<UsersScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(calledPaths(apiMock)).toContain('/roles'));
    expect(within(dialog).queryByRole('group', { name: /grants$/ })).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calledPaths(apiMock)).toContain('/users/user-2'));
  });
});
