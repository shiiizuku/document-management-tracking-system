import 'reflect-metadata';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { Database } from '../src/database/client.js';
import { divisions, sections } from '../src/database/schema.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { REALTIME_CHANNEL, NOTIFICATION_EVENT } from '../src/modules/realtime/realtime.contract.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive realtime int test');
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

const PASSWORD = 'RealtimePass123!';
const DIV = '00000000-0000-4000-9000-0000000000e0';
const SEC = '00000000-0000-4000-9000-0000000000e1';

const sessionCookieOf = (setCookies: string[]): string => {
  const cookies = setCookies.map((entry) => entry.split(';')[0] ?? '');
  const session = cookies.find((pair) => pair.startsWith('dts_session='));
  if (session === undefined) throw new Error('login did not set a session cookie');
  return session;
};

describe('realtime notifications over Socket.IO', () => {
  let app: INestApplication;
  let publisher: Redis;
  let userId: string;
  let sessionCookie: string;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    await app.init();
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as Server;
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;

    const database = app.get<Database>(DATABASE);
    await database.execute(
      sql.raw(
        'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      ),
    );
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await database.insert(divisions).values({ id: DIV, code: 'RTIM', name: 'Realtime Division' });
    await database
      .insert(sections)
      .values({ id: SEC, divisionId: DIV, code: 'R1', name: 'Realtime Section' });
    const user = await app.get(UsersRepository).insert({
      email: 'realtime@dts.local',
      displayName: 'Realtime User',
      passwordHash: hashSync(PASSWORD, 4),
      role: 'STAFF_MEMBER',
      divisionId: DIV,
      sectionId: SEC,
      canAccessConfidential: false,
    });
    userId = user.id;

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'realtime@dts.local', password: PASSWORD }),
    });
    expect(login.status).toBe(201);
    sessionCookie = sessionCookieOf(login.headers.getSetCookie());

    publisher = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }, 30_000);

  afterAll(async () => {
    publisher?.disconnect();
    await app?.close();
  });

  const connect = (cookie: string | undefined): ClientSocket =>
    io(`${baseUrl}/realtime`, {
      transports: ['websocket'],
      forceNew: true,
      ...(cookie ? { extraHeaders: { cookie } } : {}),
    });

  it('delivers a published notification to the recipient’s authenticated socket', async () => {
    const client = connect(sessionCookie);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });

      const received = new Promise<Record<string, unknown>>((resolve) => {
        client.once(NOTIFICATION_EVENT, (payload: Record<string, unknown>) => resolve(payload));
      });

      // Publish exactly what the worker's consumer would for an assignment.
      await publisher.publish(
        REALTIME_CHANNEL,
        JSON.stringify({
          userId,
          event: NOTIFICATION_EVENT,
          payload: { documentId: 'doc-123' },
        }),
      );

      const payload = await Promise.race([
        received,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error('did not receive the realtime event in time')), 5_000),
        ),
      ]);
      expect(payload).toEqual({ documentId: 'doc-123' });
    } finally {
      client.disconnect();
    }
  }, 30_000);

  it('does not deliver a notification meant for a different user', async () => {
    const client = connect(sessionCookie);
    try {
      await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
      });

      let leaked = false;
      client.once(NOTIFICATION_EVENT, () => {
        leaked = true;
      });
      await publisher.publish(
        REALTIME_CHANNEL,
        JSON.stringify({
          userId: 'someone-else',
          event: NOTIFICATION_EVENT,
          payload: { documentId: 'doc-999' },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(leaked).toBe(false);
    } finally {
      client.disconnect();
    }
  }, 30_000);

  it('rejects a socket that presents no session', async () => {
    const client = connect(undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        // An unauthenticated socket is disconnected right after connecting.
        client.once('disconnect', () => resolve());
        client.once('connect', () => {
          /* connection is allowed, but the server disconnects it immediately */
        });
        setTimeout(() => reject(new Error('socket was neither disconnected nor rejected')), 5_000);
      });
      expect(client.connected).toBe(false);
    } finally {
      client.disconnect();
    }
  }, 30_000);
});
