import { NOTIFICATION_EVENT, type RealtimeMessage } from './realtime.contract.js';

/**
 * Maps a published outbox event to the realtime message it should fan out, or `null` when the
 * event does not concern a specific user. Kept pure so the routing is unit-tested without Redis.
 *
 * Today only an assignment creates a user-facing notification (see `DocumentsService.assign`), so
 * that is the one event mapped; new notification sources are added here beside their outbox event.
 * The payload is intentionally a hint — the recipient's client refetches its inbox — so no
 * notification content travels over the pub/sub channel.
 */
export const realtimeMessageForEvent = (
  eventType: string,
  payload: Record<string, unknown>,
): RealtimeMessage | null => {
  if (eventType === 'document.assigned') {
    const userId = payload.recipientUserId;
    if (typeof userId !== 'string') return null;
    const documentId = typeof payload.documentId === 'string' ? payload.documentId : null;
    return {
      userId,
      event: NOTIFICATION_EVENT,
      payload: documentId === null ? {} : { documentId },
    };
  }
  return null;
};
