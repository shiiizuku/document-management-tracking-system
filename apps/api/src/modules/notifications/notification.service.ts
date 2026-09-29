import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';

export type NotificationType =
  'DOCUMENT_ASSIGNED' | 'SIGNATURE_REQUIRED' | 'REVISION_REQUIRED' | 'DOCUMENT_RELEASED';

export interface NotificationRecord {
  readonly id: string;
  readonly cursor: number;
  readonly recipientUserId: string;
  readonly type: NotificationType;
  readonly title: string;
  readonly body: string;
  readonly documentId: string;
  readonly idempotencyKey: string;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

export type CreateNotificationInput = Omit<
  NotificationRecord,
  'id' | 'cursor' | 'createdAt' | 'readAt'
>;

/**
 * In-memory notification store (Phase 5 replaces it with persisted rows + realtime fan-out).
 * A DI singleton so notifications created during a document assignment are visible to the
 * recipient's inbox reads within the running app.
 */
@Injectable()
export class NotificationService {
  readonly #notifications = new Map<string, NotificationRecord>();
  readonly #idByIdempotencyKey = new Map<string, string>();
  #cursor = 0;

  create(input: CreateNotificationInput): NotificationRecord {
    const existingId = this.#idByIdempotencyKey.get(input.idempotencyKey);
    if (existingId !== undefined) {
      return this.requireOwned(input.recipientUserId, existingId);
    }

    const notification: NotificationRecord = Object.freeze({
      ...input,
      id: randomUUID(),
      cursor: ++this.#cursor,
      createdAt: new Date(),
      readAt: null,
    });
    this.#notifications.set(notification.id, notification);
    this.#idByIdempotencyKey.set(notification.idempotencyKey, notification.id);
    return notification;
  }

  list(recipientUserId: string, afterCursor = 0): NotificationRecord[] {
    return [...this.#notifications.values()]
      .filter(
        (notification) =>
          notification.recipientUserId === recipientUserId && notification.cursor > afterCursor,
      )
      .sort((left, right) => left.cursor - right.cursor);
  }

  unreadCount(recipientUserId: string): number {
    return this.list(recipientUserId).filter((notification) => notification.readAt === null).length;
  }

  markRead(recipientUserId: string, notificationId: string): NotificationRecord {
    const notification = this.requireOwned(recipientUserId, notificationId);
    if (notification.readAt !== null) {
      return notification;
    }
    const updated = Object.freeze({ ...notification, readAt: new Date() });
    this.#notifications.set(notificationId, updated);
    return updated;
  }

  private requireOwned(recipientUserId: string, notificationId: string): NotificationRecord {
    const notification = this.#notifications.get(notificationId);
    if (notification === undefined || notification.recipientUserId !== recipientUserId) {
      throw new Error('Notification not found');
    }
    return notification;
  }
}
