import 'reflect-metadata';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Queue, Worker } from 'bullmq';
import request from 'supertest';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { Database } from '../src/database/client.js';
import { divisions, sections } from '../src/database/schema.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { createOutboxQueue, createOutboxWorker } from '../src/modules/jobs/outbox-queue.js';
import { OutboxRelay } from '../src/modules/jobs/outbox-relay.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error(
    'ALLOW_DATABASE_RESET=true is required for the destructive notifications int test',
  );
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required for the outbox integration test');

const RECORDS_PASSWORD = 'RecordsPass1234!';
const STAFF_PASSWORD = 'StaffPass12345!';
const DIV = '00000000-0000-4000-9000-0000000000e0';
const SEC = '00000000-0000-4000-9000-0000000000e1';

interface Session {
  cookies: string[];
}
const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

describe('notifications, outbox relay and dashboard against real Postgres + Redis', () => {
  let app: INestApplication;
  let queue: Queue;
  let worker: Worker | undefined;
  let staffId: string;
  let records: Session;
  let staff: Session;
  const server = (): Server => app.getHttpServer() as Server;

  const login = async (email: string, password: string): Promise<Session> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    const raw = (response.headers as Record<string, string | string[] | undefined>)['set-cookie'];
    const setCookies: string[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    return { cookies: setCookies.map((entry) => entry.split(';')[0] ?? '') };
  };

  const createDoc = async (): Promise<{ id: string }> =>
    dataOf<{ id: string }>(
      await request(server())
        .post('/api/v1/documents')
        .set('Cookie', records.cookies)
        .send({
          title: 'Doc to assign',
          type: 'LETTER',
          priority: 'NORMAL',
          direction: 'INCOMING',
          sender: 'External',
          divisionId: DIV,
          sectionId: SEC,
        })
        .expect(201),
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    await app.init();

    const database = app.get<Database>(DATABASE);
    await database.execute(
      sql.raw(
        'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      ),
    );
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    await database.insert(divisions).values({ id: DIV, code: 'NOTF', name: 'Notify Division' });
    await database
      .insert(sections)
      .values({ id: SEC, divisionId: DIV, code: 'N1', name: 'Notify Section' });
    const users = app.get(UsersRepository);
    await users.insert({
      email: 'records@dts.local',
      displayName: 'Records Officer',
      passwordHash: hashSync(RECORDS_PASSWORD, 4),
      role: 'RECORDS_STAFF',
      divisionId: null,
      sectionId: null,
      canAccessConfidential: true,
    });
    const staffUser = await users.insert({
      email: 'staff@dts.local',
      displayName: 'Notify Staff',
      passwordHash: hashSync(STAFF_PASSWORD, 4),
      role: 'STAFF_MEMBER',
      divisionId: DIV,
      sectionId: SEC,
      canAccessConfidential: false,
    });
    staffId = staffUser.id;

    queue = createOutboxQueue(redisUrl);
    await queue.obliterate({ force: true }); // clear any leftover jobs from a prior run

    records = await login('records@dts.local', RECORDS_PASSWORD);
    staff = await login('staff@dts.local', STAFF_PASSWORD);
  }, 30_000);

  afterAll(async () => {
    if (worker) await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await app.close();
  });

  it('writes a durable notification in the assignment transaction and exposes the inbox', async () => {
    const doc = await createDoc();
    await request(server())
      .post(`/api/v1/documents/${doc.id}/assignments`)
      .set('Cookie', records.cookies)
      .send({ recipientUserId: staffId })
      .expect(201);

    const inbox = dataOf<{ items: { type: string; documentId: string }[]; unreadCount: number }>(
      await request(server()).get('/api/v1/notifications').set('Cookie', staff.cookies).expect(200),
    );
    const mine = inbox.items.find((item) => item.documentId === doc.id);
    expect(mine).toMatchObject({ type: 'DOCUMENT_ASSIGNED' });
    expect(inbox.unreadCount).toBeGreaterThanOrEqual(1);

    // Re-assigning the same recipient is idempotent: no duplicate notification row.
    await request(server())
      .post(`/api/v1/documents/${doc.id}/assignments`)
      .set('Cookie', records.cookies)
      .send({ recipientUserId: staffId })
      .expect(201);
    const inbox2 = dataOf<{ items: { documentId: string }[] }>(
      await request(server()).get('/api/v1/notifications').set('Cookie', staff.cookies).expect(200),
    );
    expect(inbox2.items.filter((item) => item.documentId === doc.id)).toHaveLength(1);
  }, 30_000);

  it('marks notifications read', async () => {
    const inbox = dataOf<{ items: { id: string }[] }>(
      await request(server()).get('/api/v1/notifications').set('Cookie', staff.cookies).expect(200),
    );
    const first = inbox.items[0]!;
    await request(server())
      .post(`/api/v1/notifications/${first.id}/read`)
      .set('Cookie', staff.cookies)
      .expect(201);
    const after = dataOf<{ unreadCount: number }>(
      await request(server()).get('/api/v1/notifications').set('Cookie', staff.cookies).expect(200),
    );
    expect(after.unreadCount).toBe(0);
  }, 30_000);

  it('publishes committed outbox events onto the queue exactly once and a worker consumes them', async () => {
    const doc = await createDoc();
    await request(server())
      .post(`/api/v1/documents/${doc.id}/assignments`)
      .set('Cookie', records.cookies)
      .send({ recipientUserId: staffId })
      .expect(201);

    const database = app.get<Database>(DATABASE);
    const relay = new OutboxRelay(database, queue);

    const published = await relay.drain();
    expect(published).toBeGreaterThanOrEqual(1);
    const waiting = await queue.getWaiting();
    expect(waiting.some((job) => job.data.eventType === 'document.assigned')).toBe(true);

    // A real worker drains the queue to completion — the full Redis round-trip.
    const completed = new Promise<void>((resolve) => {
      worker = createOutboxWorker(redisUrl, () => Promise.resolve());
      worker.on('completed', () => resolve());
    });
    await completed;

    // The rows are now published, so a second pass re-enqueues nothing.
    const republished = await relay.drain();
    expect(republished).toBe(0);
  }, 30_000);

  it('reports a scope-aware dashboard summary', async () => {
    const summary = dataOf<{ total: number; byStatus: Record<string, number>; overdue: number }>(
      await request(server())
        .get('/api/v1/dashboard/summary')
        .set('Cookie', records.cookies)
        .expect(200),
    );
    expect(summary.total).toBeGreaterThanOrEqual(2);
    expect(summary.byStatus.PENDING).toBeGreaterThanOrEqual(2);
    expect(summary.overdue).toBe(0);
  }, 30_000);
});
