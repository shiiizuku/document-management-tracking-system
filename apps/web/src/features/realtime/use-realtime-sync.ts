'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { invalidateAllDocuments, invalidateDocument } from '@/features/documents/queries';
import { invalidateNotifications } from '@/features/notifications/queries';
import { API_URL } from '@/lib/api';

/**
 * Keeps the open app in step with the server.
 *
 * Mounted once by the `(app)` layout. It is the only thing in the app that knows a socket exists:
 * everything it touches, it touches through the domain modules' own invalidation functions, so a
 * change to how documents or notifications are cached does not reach this file.
 *
 * Realtime is additive, not load-bearing. The server's message is a hint to refetch and carries
 * no content, so if the socket never connects the inbox still fills on open and after each
 * mark-read. A missed connection makes the app less live, not wrong.
 */

/** The API origin, without the `/api/v1` path — where the Socket.IO namespace is mounted. */
const socketOrigin = (): string => {
  try {
    return new URL(API_URL).origin;
  } catch {
    return 'http://localhost:4001';
  }
};

/** The server's "your notifications changed" ping; the payload may name the document involved. */
const NOTIFICATION_EVENT = 'notification';

/** Sent once the server has put this socket in its user room — pings reach it from then on. */
const READY_EVENT = 'ready';

export interface RealtimeStatus {
  /** Whether the socket is currently connected, for the live indicator in the inbox. */
  connected: boolean;
}

export function useRealtimeSync(): RealtimeStatus {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // The handshake carries the session cookie, so the server authenticates the socket exactly as
    // it authenticates a REST request. An unauthenticated socket is simply closed.
    const socket: Socket = io(`${socketOrigin()}/realtime`, {
      withCredentials: true,
      transports: ['websocket'],
    });

    // Pings sent while the socket was down are gone, not queued, so each time the server reports the
    // socket ready (after its room join) the inbox and documents are refetched from the database.
    // That includes the first: a change after the mount queries loaded but before the handshake
    // finished would otherwise stay stale until the next ping. `connect` itself is too early.
    let stopWaiting: (() => void) | null = null;
    const catchUp = () => {
      stopWaiting?.();
      const refetch = () => {
        invalidateNotifications(client);
        invalidateAllDocuments(client);
      };
      const fetching = client.isFetching() > 0;
      refetch();
      if (!fetching) return;
      // A query with no data yet reuses its in-flight request instead of restarting it, and that
      // request may have read the database before the missed change. Once everything settles,
      // refetch again so a request that started after the catch-up is the one that stays cached.
      stopWaiting = client.getQueryCache().subscribe(() => {
        if (client.isFetching() > 0) return;
        stopWaiting?.();
        stopWaiting = null;
        refetch();
      });
    };
    socket.on('connect', () => setConnected(true));
    socket.on(READY_EVENT, catchUp);
    socket.on('disconnect', () => setConnected(false));
    socket.on(NOTIFICATION_EVENT, (payload: unknown) => {
      invalidateNotifications(client);
      // The ping is sent because something happened TO a document — an assignment or a forward —
      // so the document itself and every list it appears in are stale as well, not just the inbox.
      const documentId = documentIdFrom(payload);
      invalidateDocument(client, documentId);
    });

    return () => {
      stopWaiting?.();
      socket.disconnect();
      setConnected(false);
    };
  }, [client]);

  return { connected };
}

/**
 * Reads the document id out of an event payload, if it carries one.
 *
 * Defensive on purpose: the payload is whatever arrived over the wire, and an event shape that
 * changes server-side must degrade to "refresh the lists" rather than throw inside a socket
 * handler, where nothing would catch it.
 */
const documentIdFrom = (payload: unknown): string | undefined => {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const id = (payload as { documentId?: unknown }).documentId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
};
