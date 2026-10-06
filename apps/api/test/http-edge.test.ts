import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureHttpApp } from '../src/http-app.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';
import { UPLOAD_RATE_LIMIT } from '../src/modules/files/files.controller.js';
import { REPORT_EXPORT_RATE_LIMIT } from '../src/modules/reports/reports.controller.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';

/*
 * The HTTP edge as it ships: `configureHttpApp` is what `main.ts` calls, so these assert the
 * production headers, allowlist and limits rather than a test's copy of them (D6, Phase 7).
 */

// setup-env.ts pins WEB_ORIGIN to the local web port.
const ALLOWED_ORIGIN = 'http://localhost:3001';

const createApp = async (
  override: Record<string, unknown> = {},
): Promise<NestExpressApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UsersRepository)
    .useClass(InMemoryUsersRepository)
    .overrideProvider(AuditWriter)
    .useClass(InMemoryAuditWriter)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  const config = app.get(ConfigService);
  for (const [key, value] of Object.entries(override)) config.set(key, value);
  configureHttpApp(app);
  await app.init();
  return app;
};

describe('the HTTP edge', () => {
  let app: NestExpressApplication | undefined;
  const server = (): Server => (app as NestExpressApplication).getHttpServer();

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  describe('secure headers', () => {
    it('sends the helmet baseline on an API response', async () => {
      app = await createApp();
      const response = await request(server()).get('/api/v1/health');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['cross-origin-opener-policy']).toBe('same-origin');
      expect(response.headers['content-security-policy']).toContain("default-src 'self'");
      expect(response.headers['content-security-policy']).toContain("object-src 'none'");
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS allowlist', () => {
    it('admits the configured web origin with credentials', async () => {
      app = await createApp();
      const response = await request(server())
        .options('/api/v1/auth/me')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'GET');

      expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not reflect an origin that is not on the list', async () => {
      app = await createApp();
      for (const origin of ['https://evil.example', 'http://localhost:3001.evil.example', 'null']) {
        const response = await request(server())
          .options('/api/v1/auth/me')
          .set('Origin', origin)
          .set('Access-Control-Request-Method', 'GET');

        expect(response.headers['access-control-allow-origin']).toBeUndefined();
      }
    });
  });

  describe('the OpenAPI UI', () => {
    it('is served when API_DOCS is on (the development default)', async () => {
      app = await createApp();
      await request(server()).get('/api/docs').expect(200);
    });

    it('is not served when API_DOCS is off (the production default)', async () => {
      app = await createApp({ API_DOCS: false });
      await request(server()).get('/api/docs').expect(404);
      await request(server()).get('/api/docs-json').expect(404);
    });
  });

  // The throttler is a global guard, so it counts a request before the controller's AuthGuard
  // decides it: an unauthenticated caller is refused 401 until the route's window is spent,
  // then 429. That is the property that matters — the window applies whoever is asking.
  describe('expensive-route rate limits', () => {
    it(`caps attachment uploads at ${UPLOAD_RATE_LIMIT.limit} a minute`, async () => {
      app = await createApp();
      const upload = () => request(server()).post('/api/v1/documents/any/attachments');
      for (let i = 0; i < UPLOAD_RATE_LIMIT.limit; i += 1) await upload().expect(401);
      await upload().expect(429);
    });

    // The throttler keys a window on the route, so each format has its own ten.
    it.each(['pdf', 'xlsx'])(
      `caps %s report exports at ${REPORT_EXPORT_RATE_LIMIT.limit} a minute`,
      async (format) => {
        app = await createApp();
        const exportReport = () => request(server()).get(`/api/v1/reports/monthly.${format}`);
        for (let i = 0; i < REPORT_EXPORT_RATE_LIMIT.limit; i += 1)
          await exportReport().expect(401);
        await exportReport().expect(429);
      },
    );

    it('leaves the on-screen report on the default bucket', async () => {
      app = await createApp();
      for (let i = 0; i < REPORT_EXPORT_RATE_LIMIT.limit + 5; i += 1)
        await request(server()).get('/api/v1/reports/monthly').expect(401);
    });
  });
});
