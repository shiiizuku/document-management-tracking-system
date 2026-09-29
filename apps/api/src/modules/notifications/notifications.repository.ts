import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { notifications } from '../../database/schema.js';

export type NotificationRow = typeof notifications.$inferSelect;

export interface NewNotification {
  recipientUserId: string;
  type: string;
  title: string;
  body: string;
  documentId: string | null;
  idempotencyKey: string;
}

const DEFAULT_PAGE = 30;
const MAX_PAGE = 100;

/** Encodes/decodes the keyset cursor as `<createdAtMillis>_<id>` so paging is stable under ties. */
const encodeCursor = (row: NotificationRow): string => `${row.createdAt.getTime()}_${row.id}`;
const decodeCursor = (cursor: string): { createdAt: Date; id: string } | null => {
  const separator = cursor.lastIndexOf('_');
  if (separator === -1) return null;
  const millis = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  if (!Number.isFinite(millis) || id.length === 0) return null;
  return { createdAt: new Date(millis), id };
};

/**
 * The durable notification inbox (`notifications`). Rows are written in the same transaction as
 * the domain change that produced them (decision: a notification never goes missing because a
 * background worker was down), so this repository's `insert` takes an executor. The unique
 * `idempotency_key` makes a retried use case a no-op rather than a duplicate.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(values: NewNotification, executor: DatabaseExecutor = this.database): Promise<void> {
    await executor
      .insert(notifications)
      .values(values)
      .onConflictDoNothing({ target: notifications.idempotencyKey });
  }

  /** Newest-first page for a recipient; `cursor` (from a previous page) fetches older rows. */
  async list(
    recipientUserId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
    const limit = Math.min(MAX_PAGE, Math.max(1, options.limit ?? DEFAULT_PAGE));
    const decoded = options.cursor ? decodeCursor(options.cursor) : null;
    const keyset = decoded
      ? or(
          lt(notifications.createdAt, decoded.createdAt),
          and(eq(notifications.createdAt, decoded.createdAt), lt(notifications.id, decoded.id)),
        )
      : undefined;
    const rows = await this.database
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, recipientUserId), keyset))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit && items.length > 0 ? encodeCursor(items[items.length - 1]!) : null;
    return { items, nextCursor };
  }

  async unreadCount(recipientUserId: string): Promise<number> {
    const [row] = await this.database
      .select({ total: count() })
      .from(notifications)
      .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)));
    return row?.total ?? 0;
  }

  /** Marks one notification read, but only if it belongs to the caller. */
  async markRead(recipientUserId: string, id: string): Promise<NotificationRow | null> {
    const [row] = await this.database
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, now())` })
      .where(and(eq(notifications.id, id), eq(notifications.recipientUserId, recipientUserId)))
      .returning();
    return row ?? null;
  }

  async markAllRead(recipientUserId: string): Promise<number> {
    const rows = await this.database
      .update(notifications)
      .set({ readAt: sql`now()` })
      .where(and(eq(notifications.recipientUserId, recipientUserId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return rows.length;
  }
}
