import { inArray, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import type { Database } from '../../database/client.js';
import { outboxEvents } from '../../database/schema.js';
import type { OutboxJobData } from './outbox-queue.js';

interface LeasedRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
}

/**
 * The transactional-outbox publisher. Each pass leases a batch of unpublished `outbox_events`
 * with `FOR UPDATE SKIP LOCKED` — so several relay instances never fight over the same rows —
 * enqueues each as a BullMQ job keyed by its `idempotency_key`, then marks the rows published,
 * all in one transaction. The row lock is held until commit, and the job's `jobId` is the
 * idempotency key, so the two failure windows are both safe:
 *
 *  - enqueue succeeds then the transaction rolls back → the row stays unpublished and is
 *    re-leased later; the re-`add` with the same `jobId` is de-duplicated by BullMQ.
 *  - the transaction commits → the row is published exactly once and never re-leased.
 *
 * That is the "committed events are never lost, and are delivered at least once" guarantee, with
 * consumer-side idempotency (the unique notification key) collapsing at-least-once to once in
 * effect.
 */
export class OutboxRelay {
  constructor(
    private readonly database: Database,
    private readonly queue: Queue<OutboxJobData>,
  ) {}

  async drain(limit = 50): Promise<number> {
    return this.database.transaction(async (tx) => {
      const leased = await tx.execute(
        sql`select id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
            from outbox_events
            where published_at is null
            order by created_at
            limit ${limit}
            for update skip locked`,
      );
      const rows = (leased as unknown as { rows: LeasedRow[] }).rows;
      if (rows.length === 0) return 0;

      for (const row of rows) {
        await this.queue.add(
          row.event_type,
          {
            outboxId: row.id,
            aggregateType: row.aggregate_type,
            aggregateId: row.aggregate_id,
            eventType: row.event_type,
            payload: row.payload,
          },
          // The outbox row's own id is the job id (a uuid — BullMQ forbids ':' in custom ids).
          // Deterministic per event, so a re-leased row that was already enqueued de-duplicates.
          { jobId: row.id },
        );
      }

      const ids = rows.map((row) => row.id);
      await tx
        .update(outboxEvents)
        .set({ publishedAt: new Date() })
        .where(inArray(outboxEvents.id, ids));
      return rows.length;
    });
  }
}
