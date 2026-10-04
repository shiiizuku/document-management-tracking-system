import 'reflect-metadata';
import { config } from 'dotenv';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { StructuredLogger } from './common/structured-logger.js';
import { startWorkerHealthServer, type WorkerCheckState } from './worker-runtime.js';
import { createDatabase } from './database/client.js';
import { createOutboxQueue, createOutboxWorker } from './modules/jobs/outbox-queue.js';
import { OutboxRelay } from './modules/jobs/outbox-relay.js';
import { DrizzleAuditWriter } from './modules/audit/audit.writer.js';
import { ClamAvScanner } from './modules/files/clamav-scanner.js';
import { FileVersionsRepository } from './modules/files/file-versions.repository.js';
import { MinioStorageAdapter } from './modules/files/minio-storage.adapter.js';
import { scanUploadedVersion } from './modules/files/scan-consumer.js';
import { RealtimePublisher } from './modules/realtime/realtime.publisher.js';
import { realtimeMessagesForEvent } from './modules/realtime/realtime.events.js';

config({ path: new URL('../../../.env', import.meta.url) });
const environment = validateEnvironment(process.env);
const logger = new StructuredLogger({ service: 'dts-worker' });

// Pool size only: the worker serves no interactive request, so it keeps no statement cap.
const { db, pool } = createDatabase(environment.DATABASE_URL, {
  poolMax: environment.DATABASE_POOL_MAX,
});
const queue = createOutboxQueue(environment.REDIS_URL);
const relay = new OutboxRelay(db, queue);

// The scan pipeline: an `attachment.uploaded` event carries a version to a ClamAV scan, and the
// verdict is written back to the version row. These collaborators are built directly (not via
// Nest DI) because the worker is a plain Node process.
const configService = new ConfigService(environment);
const versions = new FileVersionsRepository(db);
const storage = new MinioStorageAdapter(configService);
const auditWriter = new DrizzleAuditWriter(db);
const scanner = new ClamAvScanner({
  host: environment.CLAMAV_HOST,
  port: environment.CLAMAV_PORT,
});
const scanLogger = {
  log: (message: string) => logger.log(message, 'ScanConsumer'),
  warn: (message: string) => logger.warn(message, 'ScanConsumer'),
};

// A small connection dedicated to the readiness ping, kept separate from BullMQ's own
// connections so a probe never contends with queue traffic. `lazyConnect` defers the socket
// until the first ping; one retry per request means a down Redis fails fast instead of hanging.
const redisProbeClient = new Redis(environment.REDIS_URL, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
});

// A normal (non-subscriber) Redis connection for publishing realtime fan-out; the API's bridge
// subscribes to the same channel. Separate from BullMQ's own connections.
const realtimePublishClient = new Redis(environment.REDIS_URL, { maxRetriesPerRequest: null });
const realtimePublisher = new RealtimePublisher(realtimePublishClient);

// Consumer of published domain events. An uploaded attachment is scanned; any other event that
// concerns a specific user is fanned out to that user's live sockets via the realtime channel.
// The durable notification inbox is written in the domain transaction, so it does not depend on
// this worker.
const worker = createOutboxWorker(environment.REDIS_URL, async (job) => {
  if (job.data.eventType === 'attachment.uploaded') {
    const versionId = job.data.payload.versionId;
    if (typeof versionId !== 'string')
      throw new Error(`attachment.uploaded event ${job.data.outboxId} has no versionId`);
    await scanUploadedVersion(
      { versions, storage, scanner, audit: auditWriter, logger: scanLogger },
      versionId,
    );
    return;
  }
  logger.log(`delivered ${job.data.eventType} for ${job.data.aggregateId}`, 'OutboxConsumer');
  for (const message of realtimeMessagesForEvent(job.data.eventType, job.data.payload))
    await realtimePublisher.publish(message);
});
worker.on('failed', (job, error) => logger.error(error, `OutboxConsumer:${job?.id ?? 'unknown'}`));

// Poll the outbox and publish committed events onto the queue. A fixed interval is enough at
// pilot volume; a LISTEN/NOTIFY trigger is a later optimization.
const relayInterval = setInterval(() => {
  void relay.drain().catch((error: unknown) => logger.error(error, 'OutboxRelay'));
}, 1_000);

// Readiness reflects the worker's own critical path: it can only drain the outbox if both
// Postgres (the source of events) and Redis (the queue) answer, pinged via the dedicated
// probe connection above.
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
