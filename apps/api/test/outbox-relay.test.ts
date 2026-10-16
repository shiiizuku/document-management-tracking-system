import type { Queue } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/client.js';
import type { OutboxJobData } from '../src/modules/jobs/outbox-queue.js';
import { OutboxRelay } from '../src/modules/jobs/outbox-relay.js';

/** One leased batch, a recording queue, and a transaction that accepts the publish update. */
const setup = (rows: { id: string; event_type: string }[]) => {
  const leased = rows.map((row) => ({
    ...row,
    aggregate_type: 'aggregate',
    aggregate_id: 'aggregate-1',
    payload: {},
    idempotency_key: `${row.event_type}:${row.id}`,
  }));
  const tx = {
    execute: vi.fn(() => Promise.resolve({ rows: leased })),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
  };
  const database = {
    transaction: (run: (handle: typeof tx) => Promise<number>) => run(tx),
  } as unknown as Database;
  const add = vi.fn(() => Promise.resolve());
  const queue = { add } as unknown as Queue<OutboxJobData>;
  return { relay: new OutboxRelay(database, queue), add };
};

describe('OutboxRelay', () => {
  it('gives mail.send a retry window of about an hour and leaves other events on the defaults', async () => {
    const h = setup([
      { id: 'outbox-mail', event_type: 'mail.send' },
      { id: 'outbox-upload', event_type: 'attachment.uploaded' },
    ]);

    expect(await h.relay.drain()).toBe(2);

    expect(h.add).toHaveBeenCalledWith(
      'mail.send',
      expect.objectContaining({ outboxId: 'outbox-mail' }),
      {
        jobId: 'outbox-mail',
        attempts: 8,
        backoff: { type: 'exponential', delay: 30_000 },
      },
    );
    expect(h.add).toHaveBeenCalledWith(
      'attachment.uploaded',
      expect.objectContaining({ outboxId: 'outbox-upload' }),
      { jobId: 'outbox-upload' },
    );
  });
});
