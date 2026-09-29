import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
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

describe('REST /api/v1 rate limiting', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UsersRepository)
      .useClass(InMemoryUsersRepository)
      .overrideProvider(AuditWriter)
      .useClass(InMemoryAuditWriter)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('caps repeated login attempts from one client and then rejects with 429', async () => {
    const attempt = () =>
      request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'records@dts.local', password: 'wrong-password-1' });

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
});
