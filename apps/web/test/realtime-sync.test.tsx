import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRealtimeSync } from '../src/features/realtime/use-realtime-sync';
import { invalidatedKeys } from './mock-api';

/**
 * A stand-in for the Socket.IO client that records its handlers so a test can deliver an event,
 * and records whether it was disconnected.
 */
const { ioMock, socket } = vi.hoisted(() => {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const socket = {
    handlers,
    disconnected: false,
    on(event: string, handler: (payload?: unknown) => void) {
      handlers.set(event, handler);
      return socket;
    },
    disconnect() {
      socket.disconnected = true;
    },
    emitToClient(event: string, payload?: unknown) {
      handlers.get(event)?.(payload);
    },
  };
  return { ioMock: vi.fn(() => socket), socket };
});

vi.mock('socket.io-client', () => ({ io: ioMock }));

const harness = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
};

afterEach(() => {
  socket.handlers.clear();
  socket.disconnected = false;
  vi.clearAllMocks();
});

describe('useRealtimeSync', () => {
  it('connects to the realtime namespace with the session cookie', () => {
    const { wrapper } = harness();
    renderHook(() => useRealtimeSync(), { wrapper });

    expect(ioMock).toHaveBeenCalledWith(
      expect.stringContaining('/realtime'),
      expect.objectContaining({ withCredentials: true }),
    );
  });

  it('reports the connection state for the live indicator', async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useRealtimeSync(), { wrapper });

    expect(result.current.connected).toBe(false);
    socket.emitToClient('connect');
    await waitFor(() => expect(result.current.connected).toBe(true));

    socket.emitToClient('disconnect');
    await waitFor(() => expect(result.current.connected).toBe(false));
  });

  /*
   * The server's ping is a hint with no content. It means something happened to a document, so
   * the inbox, that document and every list it appears in are all stale — not just the inbox.
   */
  it('refreshes the inbox and the named document on an event', async () => {
    const { invalidate, wrapper } = harness();
    renderHook(() => useRealtimeSync(), { wrapper });

    socket.emitToClient('notification', { documentId: 'doc-7' });

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(['notifications']));
    expect(keys).toContain(JSON.stringify(['documents', 'detail', 'doc-7']));
    expect(keys).toContain(JSON.stringify(['documents', 'list']));
  });

  // An event shape that changes server-side must degrade to "refresh the lists", not throw inside
  // a socket handler where nothing would catch it.
  it.each([
    ['no payload', undefined],
    ['an empty payload', {}],
    ['a payload with no document', { recipientUserId: 'user-1' }],
    ['a non-object payload', 'surprise'],
  ])('still refreshes the lists given %s', async (_label, payload) => {
    const { invalidate, wrapper } = harness();
    renderHook(() => useRealtimeSync(), { wrapper });

    expect(() => socket.emitToClient('notification', payload)).not.toThrow();

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(['notifications']));
    expect(keys).toContain(JSON.stringify(['documents', 'list']));
    expect(keys.some((key) => key.includes('detail'))).toBe(false);
  });

  it('closes the socket when the shell unmounts', () => {
    const { wrapper } = harness();
    const { unmount } = renderHook(() => useRealtimeSync(), { wrapper });

    unmount();
    expect(socket.disconnected).toBe(true);
  });
});
