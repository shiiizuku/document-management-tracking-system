import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from '../src/features/session/login-form';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { sessionUser } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, replaceMock, searchParams } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  replaceMock: vi.fn(),
  searchParams: { value: new URLSearchParams() },
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  useSearchParams: () => searchParams.value,
}));

const signIn = async (email: string, password: string) => {
  await userEvent.clear(screen.getByLabelText('Email'));
  await userEvent.type(screen.getByLabelText('Email'), email);
  await userEvent.clear(screen.getByLabelText('Password'));
  await userEvent.type(screen.getByLabelText('Password'), password);
  await userEvent.click(screen.getByRole('button', { name: /Sign in/ }));
};

afterEach(() => {
  vi.clearAllMocks();
  searchParams.value = new URLSearchParams();
});

describe('LoginForm', () => {
  it('signs in and goes to the dashboard', async () => {
    apiMock.mockResolvedValue(sessionUser());
    renderWithQuery(<LoginForm />);

    await signIn('records@dts.local', 'Records@1234!');

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
    expect(apiMock).toHaveBeenCalledWith('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'records@dts.local', password: 'Records@1234!' }),
    });
  });

  it('returns the user to the screen their expired session interrupted', async () => {
    searchParams.value = new URLSearchParams('next=%2Fdocuments%3Fstatus%3DPENDING');
    apiMock.mockResolvedValue(sessionUser());
    renderWithQuery(<LoginForm />);

    await signIn('records@dts.local', 'Records@1234!');

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/documents?status=PENDING'));
  });

  // The sign-in page must not be usable as a redirector to someone else's site.
  it('refuses an off-site destination', async () => {
    searchParams.value = new URLSearchParams('next=https%3A%2F%2Felsewhere.example');
    apiMock.mockResolvedValue(sessionUser());
    renderWithQuery(<LoginForm />);

    await signIn('records@dts.local', 'Records@1234!');

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/dashboard'));
  });

  // The client resolves the API's own `loginSchema`, so a password the server would reject on
  // length never leaves the browser.
  it('rejects a too-short password without calling the API', async () => {
    renderWithQuery(<LoginForm />);

    await signIn('records@dts.local', 'short');

    await waitFor(() =>
      expect(screen.getByText(/expected string to have >=12 characters/i)).toBeInTheDocument(),
    );
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed email without calling the API', async () => {
    renderWithQuery(<LoginForm />);

    await signIn('not-an-email', 'Records@1234!');

    await waitFor(() => expect(screen.getByText('Invalid email address')).toBeInTheDocument());
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('shows the server refusal and stays put', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 401, code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }),
    );
    renderWithQuery(<LoginForm />);

    await signIn('records@dts.local', 'Records@1234!');

    await waitFor(() => expect(screen.getByText('Invalid credentials')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  /*
   * Decision 100: the seeded pilot credentials must never be offered to a real user. `NODE_ENV`
   * is inlined at build time, so under test (`NODE_ENV=test`, as in a production build) the
   * literals are not reachable and the fields come up empty.
   */
  it('does not prefill the seeded credentials outside a development build', () => {
    renderWithQuery(<LoginForm />);
    expect(screen.getByLabelText('Email')).toHaveValue('');
    expect(screen.getByLabelText('Password')).toHaveValue('');
  });
});
