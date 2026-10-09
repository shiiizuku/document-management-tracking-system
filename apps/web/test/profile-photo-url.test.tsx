import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useProfilePhotoUrl } from '../src/features/session/queries';
import type * as ApiModule from '../src/lib/api';

const { apiMock, inlineMock } = vi.hoisted(() => ({ apiMock: vi.fn(), inlineMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, inlineContent: inlineMock };
});

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

afterEach(() => {
  vi.clearAllMocks();
});

describe('useProfilePhotoUrl', () => {
  it('fetches the image only when the account says it has one', async () => {
    apiMock.mockResolvedValue({ hasPhoto: true });
    inlineMock.mockResolvedValue({ url: 'blob:photo', mediaType: 'image/png', release: vi.fn() });

    const { result } = renderHook(() => useProfilePhotoUrl(), { wrapper });

    await waitFor(() => expect(result.current).toBe('blob:photo'));
    expect(inlineMock).toHaveBeenCalledTimes(1);
  });

  it('stays empty, with no image request, for an account without a photo', async () => {
    apiMock.mockResolvedValue({ hasPhoto: false });

    const { result } = renderHook(() => useProfilePhotoUrl(), { wrapper });

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me'));
    expect(result.current).toBeNull();
    expect(inlineMock).not.toHaveBeenCalled();
  });

  it('fetches the bytes past the browser cache, which is not partitioned by session', async () => {
    apiMock.mockResolvedValue({ hasPhoto: true });
    inlineMock.mockResolvedValue({ url: 'blob:photo', mediaType: 'image/png', release: vi.fn() });

    const { result } = renderHook(() => useProfilePhotoUrl(), { wrapper });
    await waitFor(() => expect(result.current).toBe('blob:photo'));

    expect(inlineMock).toHaveBeenCalledWith('/me/photo', { cache: 'no-store' });
  });

  it('releases the object URL once the last avatar using it is gone', async () => {
    const release = vi.fn();
    apiMock.mockResolvedValue({ hasPhoto: true });
    inlineMock.mockResolvedValue({ url: 'blob:photo', mediaType: 'image/png', release });

    // Two consumers on one cache, as on a phone where the desktop menu stays mounted under the
    // navigation sheet.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => useProfilePhotoUrl(), { wrapper: shared });
    const second = renderHook(() => useProfilePhotoUrl(), { wrapper: shared });
    await waitFor(() => expect(second.result.current).toBe('blob:photo'));

    second.unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(release).not.toHaveBeenCalled();
    expect(first.result.current).toBe('blob:photo');

    first.unmount();
    await waitFor(() => expect(release).toHaveBeenCalled());
  });
});
