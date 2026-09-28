import 'reflect-metadata';
import { config } from 'dotenv';
import { validateEnvironment } from './config/environment.js';
import { StructuredLogger } from './common/structured-logger.js';
import { startWorkerHealthServer } from './worker-runtime.js';

config({ path: new URL('../../../.env', import.meta.url) });
const environment = validateEnvironment(process.env);
const logger = new StructuredLogger({ service: 'dts-worker' });
const port = environment.WORKER_HEALTH_PORT;
const server = await startWorkerHealthServer({ port });

const shutdown = (): void => {
  server.close((error) => {
    if (error) {
      logger.error(error, 'WorkerShutdown');
      process.exitCode = 1;
    }
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
logger.log(`worker ready on port ${port}`, 'WorkerBootstrap');
