import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { outboxEvents } from '../../database/schema.js';

export interface OutboxEvent {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  /**
   * Makes a retried use case idempotent at the queue boundary: a second enqueue with the same
   * key is dropped instead of producing a duplicate notification or email. Compose it from
   * the aggregate and the transition, e.g. `account-request.approved:<requestId>`.
   */
  idempotencyKey: string;
}

/**
 * Abstract so it doubles as the DI token; unit suites substitute an in-memory writer.
 *
 * The outbox exists so that "the change happened" and "the world was told" cannot disagree:
 * the event row is written in the same transaction as the domain change, and a separate
 * dispatcher publishes it afterwards. Phase 1 only writes to the outbox — the dispatcher and
 * its BullMQ worker arrive with the notification work in a later phase, so rows accumulate
 * unpublished until then. That is the intended state, not a leak.
 */
@Injectable()
export abstract class OutboxWriter {
  abstract enqueue(event: OutboxEvent, executor?: DatabaseExecutor): Promise<void>;
}

@Injectable()
export class DrizzleOutboxWriter extends OutboxWriter {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async enqueue(event: OutboxEvent, executor: DatabaseExecutor = this.database): Promise<void> {
    await executor
      .insert(outboxEvents)
      .values({
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payload: event.payload,
        idempotencyKey: event.idempotencyKey,
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey });
  }
}
