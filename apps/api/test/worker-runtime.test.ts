import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { startWorkerHealthServer } from '../src/worker-runtime.js';

const listenAddress = (server: Server): { port: number } => {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Worker server is not listening');
  return { port: address.port };
};

describe('worker runtime', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server?.close((error) => (error ? reject(error) : resolve())),
      );
  });

  it('stays alive and exposes health and readiness endpoints', async () => {
    server = await startWorkerHealthServer({ port: 0, host: '127.0.0.1' });
    const { port } = listenAddress(server);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toMatchObject({ status: 'ok', service: 'dts-worker' });

    const readiness = await fetch(`http://127.0.0.1:${port}/ready`);
    expect(readiness.status).toBe(200);
    await expect(readiness.json()).resolves.toEqual({ status: 'ready' });
  });
});
