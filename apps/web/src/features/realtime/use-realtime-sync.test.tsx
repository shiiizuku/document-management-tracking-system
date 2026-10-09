import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeSync } from './use-realtime-sync';

const handlers = new Map<string, (payload?: unknown) => void>();
vi.mock('socket.io-client', () => ({
  io: () => ({
    on: (event: string, fn: (payload?: unknown) => void) => handlers.set(event, fn),
    disconnect: vi.fn(),
  }),
}));

describe('useRealtimeSync', () => {
  beforeEach(() => handlers.clear());

  const setup = () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useRealtimeSync(), { wrapper });
    return { client, spy };
  };

  it('refetches inbox and documents each time the server reports the socket ready', () => {
    const { spy } = setup();

    // `connect` fires before the server has joined the user room, so it is not the signal.
    handlers.get('connect')?.();
    expect(spy).not.toHaveBeenCalled();

    handlers.get('ready')?.();
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).toContain('documents');
    expect(spy.mock.calls.length).toBe(2);

    handlers.get('disconnect')?.();
    handlers.get('connect')?.();
    handlers.get('ready')?.();
    expect(spy.mock.calls.length).toBe(4);
  });

  it('refetches once more after a query that was already fetching settles', async () => {
    const { client, spy } = setup();
    let finish: (value: string) => void = () => undefined;
    const pending = client.fetchQuery({
      queryKey: ['documents', 'slow'],
      queryFn: () => new Promise<string>((resolve) => (finish = resolve)),
    });

    handlers.get('ready')?.();
    expect(spy.mock.calls.length).toBe(2);

    finish('stale');
    await pending;
    await vi.waitFor(() => expect(spy.mock.calls.length).toBe(4));
  });
});
