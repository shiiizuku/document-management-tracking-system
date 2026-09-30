import 'reflect-metadata';
import { config } from 'dotenv';
import { Redis } from 'ioredis';
import { validateEnvironment } from './config/environment.js';
import { StructuredLogger } from './common/structured-logger.js';
import { startWorkerHealthServer } from './worker-runtime.js';
import { createDatabase } from './database/client.js';
import { createOutboxQueue, createOutboxWorker } from './modules/jobs/outbox-queue.js';
import { OutboxRelay } from './modules/jobs/outbox-relay.js';
import { RealtimePublisher } from './modules/realtime/realtime.publisher.js';
import { realtimeMessageForEvent } from './modules/realtime/realtime.events.js';

config({ path: new URL('../../../.env', import.meta.url) });
const environment = validateEnvironment(process.env);
const logger = new StructuredLogger({ service: 'dts-worker' });

const { db, pool } = createDatabase(environment.DATABASE_URL);
const queue = createOutboxQueue(environment.REDIS_URL);
const relay = new OutboxRelay(db, queue);

// A normal (non-subscriber) Redis connection for publishing realtime fan-out; the API's bridge
// subscribes to the same channel. Separate from BullMQ's own connections.
const realtimePublishClient = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null });
const realtimePublisher = new RealtimePublisher(realtimePublishClient);

// Consumer of published domain events. A delivered event is logged, and one that concerns a
// specific user is fanned out to that user's live sockets via the realtime channel. The durable
// notification inbox is written in the domain transaction, so it does not depend on this worker.
const worker = createOutboxWorker(environment.REDIS_URL, async (job) => {
  logger.log(`delivered ${job.data.eventType} for ${job.data.aggregateId}`, 'OutboxConsumer');
  const message = realtimeMessageForEvent(job.data.eventType, job.data.payload);
  if (message !== null) await realtimePublisher.publish(message);
});
worker.on('failed', (job, error) => logger.error(error, `OutboxConsumer:${job?.id ?? 'unknown'}`));

// Poll the outbox and publish committed events onto the queue. A fixed interval is enough at
// pilot volume; a LISTEN/NOTIFY trigger is a later optimization.
const relayInterval = setInterval(() => {
  void relay.drain().catch((error: unknown) => logger.error(error, 'OutboxRelay'));
}, 1_000);

const server = await startWorkerHealthServer({ port: environment.WORKER_HEALTH_PORT });

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayInterval);
  void (async () => {
    try {
      await worker.close();
      await queue.close();
      realtimePublishClient.disconnect();
      await pool.end();
    } catch (error) {
      logger.error(error, 'WorkerShutdown');
      process.exitCode = 1;
    } finally {
      server.close();
    }
  })();
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
logger.log(`worker ready on port ${environment.WORKER_HEALTH_PORT}`, 'WorkerBootstrap');
