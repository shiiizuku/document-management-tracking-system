import { io, type Socket } from 'socket.io-client';
import { API_URL } from './api';

/** The API origin (no `/api/v1` path) — where the Socket.IO server lives. */
const socketOrigin = (): string => {
  try {
    return new URL(API_URL).origin;
  } catch {
    return 'http://localhost:4000';
  }
};

export interface RealtimeHandlers {
  /** A notification-changed ping arrived; the recipient should refetch their inbox. */
  onNotification: () => void;
  /** Optional connection-state hook, e.g. to show a live indicator. */
  onConnectionChange?: (connected: boolean) => void;
}

/**
 * Opens the authenticated realtime socket and wires the notification ping to a refetch. The
 * handshake carries the session cookie (`withCredentials`), so the server authenticates it exactly
 * like a REST request. Returns a disconnect function for cleanup.
 *
 * Realtime is additive: if the socket never connects, the inbox still works through its normal
 * fetch-on-open and after each mark-read, so a missed connection degrades gracefully.
 */
export const connectRealtime = (handlers: RealtimeHandlers): (() => void) => {
  const socket: Socket = io(`${socketOrigin()}/realtime`, {
    withCredentials: true,
    transports: ['websocket'],
  });
  socket.on('connect', () => handlers.onConnectionChange?.(true));
  socket.on('disconnect', () => handlers.onConnectionChange?.(false));
  socket.on('notification', () => handlers.onNotification());
  return () => {
    socket.disconnect();
  };
};
