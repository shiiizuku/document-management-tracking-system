import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthController } from '../src/modules/health/health.controller.js';
import { HttpErrorFilter } from '../src/common/http-error.filter.js';
import { DATABASE } from '../src/database/database.constants.js';
import { StoragePort } from '../src/modules/files/storage.port.js';

// A storage stand-in whose `get` behaviour the test controls: resolve = reachable, reject = down.
const storageStub = (get: () => Promise<Uint8Array | null>): StoragePort => ({
  get,
  put: () => Promise.resolve(),
  delete: () => Promise.resolve(),
});

const buildApp = async (
  execute: () => Promise<unknown>,
  storageGet: () => Promise<Uint8Array | null> = () => Promise.resolve(null),
): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: DATABASE, useValue: { execute } },
      { provide: StoragePort, useValue: storageStub(storageGet) },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalFilters(new HttpErrorFilter());
  await app.init();
  return app;
};

describe('health endpoints', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('reports liveness without touching any dependency', async () => {
    const execute = vi.fn(() => Promise.reject(new Error('database is down')));
    app = await buildApp(execute);

    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toMatchObject({ status: 'ok', service: 'dts-api' });
    expect(Date.parse(String(response.body.timestamp))).not.toBeNaN();
    expect(execute).not.toHaveBeenCalled();
  });

  it('reports readiness when the database and object store both answer', async () => {
    app = await buildApp(() => Promise.resolve({ rows: [{ '?column?': 1 }] }));

    await request(app.getHttpServer())
      .get('/ready')
      .expect(200)
      .expect({ status: 'ready', checks: { database: 'up', storage: 'up' } });
  });

  it('exposes the same readiness probe under /health/ready for the compose healthcheck', async () => {
    app = await buildApp(() => Promise.resolve({ rows: [] }));

    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ready', checks: { database: 'up', storage: 'up' } });
  });

  it('fails readiness with 503 and a safe envelope when the database is unreachable', async () => {
    app = await buildApp(() => Promise.reject(new Error('connection refused')));

    const response = await request(app.getHttpServer()).get('/ready').expect(503);

    expect(response.body.error).toMatchObject({
      code: 'NOT_READY',
      details: { checks: { database: 'down', storage: 'up' } },
    });
    expect(typeof response.body.error.correlationId).toBe('string');
    expect(JSON.stringify(response.body)).not.toContain('connection refused');
  });

  it('fails readiness when the object store is unreachable', async () => {
    app = await buildApp(
      () => Promise.resolve({ rows: [{ '?column?': 1 }] }),
      () => Promise.reject(new Error('storage connection refused')),
    );

    const response = await request(app.getHttpServer()).get('/ready').expect(503);

    expect(response.body.error).toMatchObject({
      code: 'NOT_READY',
      details: { checks: { database: 'up', storage: 'down' } },
    });
    expect(JSON.stringify(response.body)).not.toContain('storage connection refused');
  });
});
