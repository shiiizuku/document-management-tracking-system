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

  it('refetches inbox and documents on a reconnect, but not on the first connect', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(() => useRealtimeSync(), { wrapper });

    handlers.get('connect')?.();
    expect(spy).not.toHaveBeenCalled();

    handlers.get('disconnect')?.();
    handlers.get('connect')?.();
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(keys).toContain('documents');
    expect(spy.mock.calls.length).toBe(2);
  });
});
