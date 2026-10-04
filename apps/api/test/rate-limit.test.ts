import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { parseTrustProxy } from '../src/config/environment.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';

const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

// Mirrors `main.ts`, including the `trust proxy` setting it derives from `TRUST_PROXY`.
const createApp = async (trustProxy: string | undefined): Promise<NestExpressApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(UsersRepository)
    .useClass(InMemoryUsersRepository)
    .overrideProvider(AuditWriter)
    .useClass(InMemoryAuditWriter)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.set('trust proxy', parseTrustProxy(trustProxy));
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
};

const wrongPassword = { email: 'records@dts.local', password: 'wrong-password-1' };

describe('REST /api/v1 rate limiting', () => {
  let app: NestExpressApplication;
  const server = (): Server => app.getHttpServer();

  beforeEach(async () => {
    app = await createApp(undefined);
  });

  afterEach(async () => {
    await app.close();
  });

  it('caps repeated login attempts from one client and then rejects with 429', async () => {
    const attempt = () => request(server()).post('/api/v1/auth/login').send(wrongPassword);

    // The auth window is 5 per minute (decision register 68). The first five are processed
    // (401 for the wrong password); the sixth is refused by the limiter before it is checked.
    for (let i = 0; i < 5; i += 1) {
      await attempt().expect(401);
    }
    await attempt().expect(429);
  });

  it('does not apply the tight auth window to ordinary authenticated routes', async () => {
    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: 'Records@1234!' })
      .expect(201);
    const cookie = sessionCookie(login);

    // Well beyond the 5-per-minute auth window and the 3-per-minute account-request window:
    // the tighter limits must not leak onto the rest of the API.
    for (let i = 0; i < 10; i += 1) {
      await request(server()).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    }
  });

  it('ignores X-Forwarded-For when no proxy is trusted', async () => {
    // The local-development default. Rotating the header must not buy a fresh login window,
    // or anyone could spray passwords by inventing addresses.
    for (let i = 0; i < 5; i += 1) {
      await request(server())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', `198.51.100.${i + 1}`)
        .send(wrongPassword)
        .expect(401);
    }
    await request(server())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', '198.51.100.99')
      .send(wrongPassword)
      .expect(429);
  });

  it('counts each signed-in user against their own default bucket', async () => {
    const signIn = async (email: string, password: string): Promise<string[]> =>
      sessionCookie(
        await request(server()).post('/api/v1/auth/login').send({ email, password }).expect(201),
      );
    const records = await signIn('records@dts.local', 'Records@1234!');
    const staff = await signIn('staff@dts.local', 'Staff@12345!');

    // Both users share one client address. Exhausting one user's 120/min must not lock the
    // other out, as it would if the bucket were keyed on the (ingress) address.
    for (let i = 0; i < 120; i += 1) {
      await request(server()).get('/api/v1/auth/me').set('Cookie', records).expect(200);
    }
    await request(server()).get('/api/v1/auth/me').set('Cookie', records).expect(429);
    await request(server()).get('/api/v1/auth/me').set('Cookie', staff).expect(200);
  });
});

describe('REST /api/v1 rate limiting behind a trusted proxy', () => {
  let app: NestExpressApplication;
  const server = (): Server => app.getHttpServer();
  // Supertest connects over loopback, so it stands in for a single ingress hop.
  const loginFrom = (forwardedFor: string) =>
    request(server())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send(wrongPassword);

  beforeEach(async () => {
    app = await createApp('1');
  });

  afterEach(async () => {
    await app.close();
  });

  it('gives each forwarded client its own login window', async () => {
    for (let i = 0; i < 5; i += 1) await loginFrom('203.0.113.10').expect(401);
    await loginFrom('203.0.113.10').expect(429);

    // A colleague behind the same ingress is unaffected by the first client's exhausted window.
    await loginFrom('203.0.113.20').expect(401);
  });

  it('trusts only the address the proxy appended, not what the client put before it', async () => {
    // A client can prepend anything to X-Forwarded-For; the ingress appends the address it
    // actually saw. With one trusted hop only that right-most entry counts, so varying the
    // spoofed prefix leaves every attempt in the same bucket.
    for (let i = 0; i < 5; i += 1) await loginFrom(`192.0.2.${i + 1}, 203.0.113.30`).expect(401);
    await loginFrom('192.0.2.99, 203.0.113.30').expect(429);
  });
});
