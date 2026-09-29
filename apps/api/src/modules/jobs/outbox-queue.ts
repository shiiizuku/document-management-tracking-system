import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';

/** The single queue the outbox relay publishes domain events onto. */
export const OUTBOX_QUEUE = 'dts.outbox';

export interface OutboxJobData {
  outboxId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connection its workers use, so both the
 * queue and the worker share one connection shape built from `REDIS_URL`.
 */
export const outboxConnection = (redisUrl: string): ConnectionOptions => ({
  url: redisUrl,
  maxRetriesPerRequest: null,
});

export const createOutboxQueue = (redisUrl: string): Queue<OutboxJobData> =>
  new Queue<OutboxJobData>(OUTBOX_QUEUE, {
    connection: outboxConnection(redisUrl),
    defaultJobOptions: {
      // Bounded retries with backoff; keep failures for inspection (dead-letter), drop successes.
      attempts: 5,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: false,
    },
  });

export const createOutboxWorker = (
  redisUrl: string,
  processor: Processor<OutboxJobData>,
): Worker<OutboxJobData> =>
  new Worker<OutboxJobData>(OUTBOX_QUEUE, processor, { connection: outboxConnection(redisUrl) });
