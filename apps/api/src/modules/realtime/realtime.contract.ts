/**
 * The contract shared by the two ends of realtime delivery: the worker publishes
 * {@link RealtimeMessage}s onto {@link REALTIME_CHANNEL}, and the API's bridge relays each one to
 * the recipient's socket room. Kept dependency-free so both the Nest app and the plain-Node worker
 * can import it.
 */

/** Redis pub/sub channel the worker publishes to and the API subscribes to. */
export const REALTIME_CHANNEL = 'dts:realtime';

/** Socket.IO event name for "your notifications changed; refetch". */
export const NOTIFICATION_EVENT = 'notification';

/** The room a user's sockets join, so a message fans out only to that user's connections. */
export const roomForUser = (userId: string): string => `user:${userId}`;

export interface RealtimeMessage {
  /** The user whose sockets should receive this. */
  userId: string;
  /** The Socket.IO event to emit. */
  event: string;
  /** Event data. Kept small: a hint to refetch, never the notification body itself. */
  payload: Record<string, unknown>;
}

/** Narrows an unknown parsed JSON value to a {@link RealtimeMessage}. */
export const isRealtimeMessage = (value: unknown): value is RealtimeMessage => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.userId === 'string' &&
    typeof candidate.event === 'string' &&
    typeof candidate.payload === 'object' &&
    candidate.payload !== null
  );
};

/** Parses a raw channel payload into a {@link RealtimeMessage}, or `null` if it is not one. */
export const parseRealtimeMessage = (raw: string): RealtimeMessage | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isRealtimeMessage(parsed) ? parsed : null;
};
