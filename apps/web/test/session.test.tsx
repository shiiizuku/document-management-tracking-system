import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUser } from '../src/features/session/queries';
import { useLogin, useLogout, useSession } from '../src/features/session/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';

const { apiMock, replaceMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  replaceMock: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
}));

const user: SessionUser = {
  id: 'u1',
  email: 'records@dts.local',
  displayName: 'Records Officer',
  role: 'RECORDS_STAFF',
  divisionId: 'div-1',
  sectionId: null,
  capabilities: ['DOCUMENT_CREATE', 'REPORT_VIEW'],
  canAccessConfidential: false,
  active: true,
};

const harness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useSession', () => {
  it('reports the capabilities the server granted', async () => {
    apiMock.mockResolvedValue(user);
    const { wrapper } = harness();
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user?.displayName).toBe('Records Officer');
    expect(result.current.can('REPORT_VIEW')).toBe(true);
    expect(result.current.can('USER_MANAGE')).toBe(false);
  });

  // The gate has to fail closed, not open: a control shown during the probe and withdrawn a
  // moment later is a control the user may have already clicked.
  it('denies every capability while the probe is still in flight', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSession(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.can('DOCUMENT_CREATE')).toBe(false);
  });

  it('surfaces a transport failure instead of reporting the user as signed out', async () => {
    apiMock.mockRejectedValue(new ApiError({ status: 503, code: 'HTTP_503', message: 'down' }));
    const { wrapper } = harness();
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => expect(result.current.error).toBeInstanceOf(ApiError));
    expect(result.current.user).toBeNull();
  });
});

describe('useLogin', () => {
  it('seeds the session from the login response so the shell needs no second probe', async () => {
    apiMock.mockResolvedValue(user);
    const { client, wrapper } = harness();
    const { result } = renderHook(() => useLogin(), { wrapper });

    result.current.mutate({ email: user.email, password: 'Records@1234!' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['session'])).toEqual(user);
  });

  it("drops the previous user's cached records", async () => {
    apiMock.mockResolvedValue(user);
    const { client, wrapper } = harness();
    client.setQueryData(['documents', 'list'], { items: ['someone elses document'] });
    const { result } = renderHook(() => useLogin(), { wrapper });

    result.current.mutate({ email: user.email, password: 'Records@1234!' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['documents', 'list'])).toBeUndefined();
  });
});

describe('useLogout', () => {
  it('clears the cache and returns to the landing page', async () => {
    apiMock.mockResolvedValue(undefined);
    const { client, wrapper } = harness();
    client.setQueryData(['session'], user);
    const { result } = renderHook(() => useLogout(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(client.getQueryData(['session'])).toBeUndefined();
  });

  // The user asked to leave. A network failure must not leave their records on screen.
  it('clears the cache even when the logout request fails', async () => {
    apiMock.mockRejectedValue(new ApiError({ status: 500, code: 'HTTP_500', message: 'boom' }));
    const { client, wrapper } = harness();
    client.setQueryData(['session'], user);
    const { result } = renderHook(() => useLogout(), { wrapper });

    result.current.mutate();

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/'));
    expect(client.getQueryData(['session'])).toBeUndefined();
  });
});
