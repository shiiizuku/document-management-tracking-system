import 'reflect-metadata';
import { config } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from './config/environment.js';
import { StructuredLogger } from './common/structured-logger.js';
import { startWorkerHealthServer } from './worker-runtime.js';
import { createDatabase } from './database/client.js';
import { createOutboxQueue, createOutboxWorker } from './modules/jobs/outbox-queue.js';
import { OutboxRelay } from './modules/jobs/outbox-relay.js';
import { DrizzleAuditWriter } from './modules/audit/audit.writer.js';
import { ClamAvScanner } from './modules/files/clamav-scanner.js';
import { FileVersionsRepository } from './modules/files/file-versions.repository.js';
import { MinioStorageAdapter } from './modules/files/minio-storage.adapter.js';
import { scanUploadedVersion } from './modules/files/scan-consumer.js';

config({ path: new URL('../../../.env', import.meta.url) });
const environment = validateEnvironment(process.env);
const logger = new StructuredLogger({ service: 'dts-worker' });

const { db, pool } = createDatabase(environment.DATABASE_URL);
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

// Consumer of published domain events. An uploaded attachment is scanned; other events (realtime
// fan-out, email) plug in here — that gateway is deferred, so for now they are logged. The durable
// notification inbox is written in the domain transaction, so it does not depend on this worker.
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
