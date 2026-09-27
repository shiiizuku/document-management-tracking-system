import { describe, expect, it } from 'vitest';
import { NotificationService } from '../src/modules/notifications/notification.service.js';

describe('NotificationService public seam', () => {
  it('persists an unread notification before delivery and catches up from a cursor', () => {
    const notifications = new NotificationService();
    const first = notifications.create({
      recipientUserId: 'user-1',
      type: 'DOCUMENT_ASSIGNED',
      title: 'Document assigned',
      body: 'A document requires your attention.',
      documentId: 'document-1',
      idempotencyKey: 'assignment:document-1:user-1',
    });
    const second = notifications.create({
      recipientUserId: 'user-1',
      type: 'SIGNATURE_REQUIRED',
      title: 'Signature required',
      body: 'Please review and sign.',
      documentId: 'document-2',
      idempotencyKey: 'signature:document-2:user-1',
    });

    expect(notifications.list('user-1')).toHaveLength(2);
    expect(notifications.unreadCount('user-1')).toBe(2);
    expect(notifications.list('user-1', first.cursor)).toEqual([second]);
  });

  it('deduplicates at-least-once delivery using the idempotency key', () => {
    const notifications = new NotificationService();
    const input = {
      recipientUserId: 'user-1',
      type: 'DOCUMENT_ASSIGNED' as const,
      title: 'Document assigned',
      body: 'A document requires your attention.',
      documentId: 'document-1',
      idempotencyKey: 'assignment:document-1:user-1',
    };

    const first = notifications.create(input);
    const duplicate = notifications.create(input);
    expect(duplicate.id).toBe(first.id);
    expect(notifications.list('user-1')).toHaveLength(1);
  });

  it('keeps read state per user, persistent, and idempotent', () => {
    const notifications = new NotificationService();
    const notification = notifications.create({
      recipientUserId: 'user-1',
      type: 'DOCUMENT_ASSIGNED',
      title: 'Document assigned',
      body: 'A document requires your attention.',
      documentId: 'document-1',
      idempotencyKey: 'assignment:document-1:user-1',
    });

    expect(notifications.markRead('user-1', notification.id).readAt).toBeInstanceOf(Date);
    expect(notifications.markRead('user-1', notification.id).readAt).toEqual(
      notifications.list('user-1')[0]?.readAt,
    );
    expect(notifications.unreadCount('user-1')).toBe(0);
    expect(() => notifications.markRead('user-2', notification.id)).toThrowError(
      'Notification not found',
    );
  });
});
