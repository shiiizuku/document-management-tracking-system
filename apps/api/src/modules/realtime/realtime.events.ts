import { NOTIFICATION_EVENT, type RealtimeMessage } from './realtime.contract.js';

/**
 * Maps a published outbox event to the realtime messages it should fan out — one per user whose
 * inbox the event wrote to, and none when it concerns no specific user. Kept pure so the routing
 * is unit-tested without Redis.
 *
 * Two events write inbox rows today: an assignment (`DocumentsService.assign`), which names one
 * recipient, and a forward (`DocumentsService.route`), which names the receiving unit and any
 * divisions copied in. New notification sources are added here beside their outbox event, or
 * their inbox rows sit unseen until the recipient happens to refetch.
 *
 * The payload is intentionally a hint — the recipient's client refetches its inbox — so no
 * notification content travels over the pub/sub channel.
 */
export const realtimeMessagesForEvent = (
  eventType: string,
  payload: Record<string, unknown>,
): RealtimeMessage[] => {
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : null;
  const ping = (userId: string): RealtimeMessage => ({
    userId,
    event: NOTIFICATION_EVENT,
    payload: documentId === null ? {} : { documentId },
  });

  if (eventType === 'document.assigned') {
    const userId = payload.recipientUserId;
    return typeof userId === 'string' ? [ping(userId)] : [];
  }
  if (eventType === 'document.routed') {
    const userIds = payload.recipientUserIds;
    if (!Array.isArray(userIds)) return [];
    return userIds.filter((userId): userId is string => typeof userId === 'string').map(ping);
  }
  return [];
};
