import type { OutboxEvent } from '../src/modules/audit/outbox.writer.js';
import { OutboxWriter } from '../src/modules/audit/outbox.writer.js';

/**
 * Collects outbox events in memory so the full-app REST suites can run domain use cases
 * without a database. Deduplicates on `idempotencyKey`, matching the `onConflictDoNothing`
 * of the Drizzle writer, so a retried use case does not appear to enqueue twice.
 */
export class InMemoryOutboxWriter extends OutboxWriter {
  readonly events: OutboxEvent[] = [];
  private readonly keys = new Set<string>();

  enqueue(event: OutboxEvent): Promise<void> {
    if (!this.keys.has(event.idempotencyKey)) {
      this.keys.add(event.idempotencyKey);
      this.events.push(event);
    }
    return Promise.resolve();
  }
}
