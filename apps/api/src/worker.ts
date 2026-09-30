import 'reflect-metadata';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { validateEnvironment } from './config/environment.js';
import { StructuredLogger } from './common/structured-logger.js';
import { startWorkerHealthServer, type WorkerCheckState } from './worker-runtime.js';
import { createDatabase } from './database/client.js';
import { createOutboxQueue, createOutboxWorker } from './modules/jobs/outbox-queue.js';
import { OutboxRelay } from './modules/jobs/outbox-relay.js';

config({ path: new URL('../../../.env', import.meta.url) });
const environment = validateEnvironment(process.env);
const logger = new StructuredLogger({ service: 'dts-worker' });

const { db, pool } = createDatabase(environment.DATABASE_URL);
const queue = createOutboxQueue(environment.REDIS_URL);
const relay = new OutboxRelay(db, queue);

// A small connection dedicated to the readiness ping, kept separate from BullMQ's own
// connections so a probe never contends with queue traffic. `lazyConnect` defers the socket
// until the first ping; one retry per request means a down Redis fails fast instead of hanging.
const redisProbeClient = new Redis(environment.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

// Consumer of published domain events. Realtime fan-out (WebSocket push) and email delivery
// plug in here; that gateway is deferred, so for now a delivered event is logged. The durable
// notification inbox is written in the domain transaction, so it does not depend on this worker.
const worker = createOutboxWorker(environment.REDIS_URL, (job) => {
  logger.log(`delivered ${job.data.eventType} for ${job.data.aggregateId}`, 'OutboxConsumer');
  return Promise.resolve();
});
worker.on('failed', (job, error) => logger.error(error, `OutboxConsumer:${job?.id ?? 'unknown'}`));

// Poll the outbox and publish committed events onto the queue. A fixed interval is enough at
// pilot volume; a LISTEN/NOTIFY trigger is a later optimization.
const relayInterval = setInterval(() => {
  void relay.drain().catch((error: unknown) => logger.error(error, 'OutboxRelay'));
}, 1_000);

// Readiness reflects the worker's own critical path: it can only drain the outbox if both
// Postgres (the source of events) and Redis (the queue) answer. The Redis ping reuses the
// queue's existing connection rather than opening another.
const PROBE_TIMEOUT_MS = 2_000;
const probe = async (check: () => Promise<unknown>): Promise<WorkerCheckState> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const server = await startWorkerHealthServer({
  port: environment.WORKER_HEALTH_PORT,
  readiness: async () => {
    const [database, redis] = await Promise.all([
      probe(() => db.execute(sql`select 1`)),
      probe(() => redisProbeClient.ping()),
    ]);
    return { database, redis };
  },
});

let shuttingDown = false;
const shutdown = (): void => {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(relayInterval);
  void (async () => {
    try {
      await worker.close();
      await queue.close();
      redisProbeClient.disconnect();
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
