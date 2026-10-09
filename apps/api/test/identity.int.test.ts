import 'reflect-metadata';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { roleSchema } from '@dts/contracts';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { Database } from '../src/database/client.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive identity int test');

const ADMIN_PASSWORD = 'AdminPass1234!';

interface Session {
  cookies: string[];
  csrf: string;
}

const readSession = (response: {
  headers: Record<string, string | string[] | undefined>;
}): Session => {
  const raw = response.headers['set-cookie'];
  if (raw === undefined) throw new Error('response set no cookies');
  const setCookies = Array.isArray(raw) ? raw : [raw];
  const cookies = setCookies.map((entry) => entry.split(';')[0] ?? '');
  const csrfPair = cookies.find((pair) => pair.startsWith('dts_csrf='));
  if (csrfPair === undefined) throw new Error('login did not set a CSRF cookie');
  return { cookies, csrf: csrfPair.slice('dts_csrf='.length) };
};

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

describe('identity & organization REST against a real database', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;

  const login = async (email: string, password: string): Promise<Session> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return readSession(response);
  };

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

    await app.get(UsersRepository).insert({
      email: 'admin@dts.local',
      displayName: 'Seed Administrator',
      passwordHash: hashSync(ADMIN_PASSWORD, 4),
      role: 'ADMINISTRATOR',
      divisionId: null,
      sectionId: null,
      canAccessConfidential: true,
    });
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('runs the account lifecycle: admin sets up the org, approves a request, the user signs in', async () => {
    const admin = await login('admin@dts.local', ADMIN_PASSWORD);
    const authed = (method: 'post' | 'patch', path: string) =>
      request(server())[method](path).set('Cookie', admin.cookies).set('x-csrf-token', admin.csrf);

    // Organization tree via the real endpoints.
    const division = dataOf<{ id: string }>(
      await authed('post', '/api/v1/divisions')
        .send({ code: 'PILOT', name: 'Pilot Division' })
        .expect(201),
    );
    const section = dataOf<{ id: string }>(
      await authed('post', '/api/v1/sections')
        .send({ divisionId: division.id, code: 'INTK', name: 'Intake' })
        .expect(201),
    );

    // Self-service application (unauthenticated), then admin review.
    await request(server())
      .post('/api/v1/account-requests')
      .send({
        email: 'applicant@dts.local',
        displayName: 'Pilot Applicant',
        password: 'Applicant1234!',
        requestedDivisionId: division.id,
        requestedSectionId: section.id,
      })
      .expect(201);

    const pending = await request(server())
      .get('/api/v1/account-requests')
      .set('Cookie', admin.cookies)
      .expect(200);
    const requestRow = dataOf<{ id: string; email: string }[]>(pending).find(
      (row) => row.email === 'applicant@dts.local',
    );
    expect(requestRow).toBeDefined();

    const created = dataOf<{ id: string; role: string }>(
      await authed('post', `/api/v1/account-requests/${requestRow!.id}/approve`)
        .send({
          role: 'STAFF_MEMBER',
          divisionId: division.id,
          sectionId: section.id,
          canAccessConfidential: false,
        })
        .expect(201),
    );
    expect(created.role).toBe('STAFF_MEMBER');

    // The password the applicant chose now signs them in through the real auth flow.
    const applicant = await login('applicant@dts.local', 'Applicant1234!');

    // Scope: a staff member has neither the review capability nor people-management, so the
    // admin queue and the user list are refused — deny by default over real HTTP.
    await request(server())
      .get('/api/v1/account-requests')
      .set('Cookie', applicant.cookies)
      .expect(403);
    await request(server()).get('/api/v1/users').set('Cookie', applicant.cookies).expect(403);

    // The role table is served to whoever assigns roles, and to nobody else (decision 175).
    await request(server()).get('/api/v1/roles').set('Cookie', applicant.cookies).expect(403);
    const roles = await request(server())
      .get('/api/v1/roles')
      .set('Cookie', admin.cookies)
      .expect(200);
    expect(roles.headers['cache-control']).toBe('private, max-age=300');
    const grants = dataOf<{ role: string; readsOfficeWide: boolean }[]>(roles);
    expect(grants.map((grant) => grant.role)).toEqual(roleSchema.options);
    expect(grants.find((grant) => grant.role === 'RECORDS_STAFF')?.readsOfficeWide).toBe(true);
    expect(grants.find((grant) => grant.role === 'DIVISION_HEAD')?.readsOfficeWide).toBe(false);

    // Deactivation takes effect on the next authentication attempt.
    await authed('post', `/api/v1/users/${created.id}/deactivate`).expect(201);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'applicant@dts.local', password: 'Applicant1234!' })
      .expect(401);
  }, 30_000);

  // The three photo endpoints had no caller in any suite. A real 1x1 PNG, because the service sniffs
  // the bytes and a renamed text file must not pass.
  it('stores a profile photo and serves it back to its owner and to an administrator', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const admin = await login('admin@dts.local', ADMIN_PASSWORD);
    const adminId = dataOf<{ id: string }>(
      await request(server()).get('/api/v1/me').set('Cookie', admin.cookies).expect(200),
    ).id;

    const before = await request(server()).get('/api/v1/me').set('Cookie', admin.cookies);
    expect(dataOf<{ hasPhoto: boolean }>(before).hasPhoto).toBe(false);
    await request(server()).get('/api/v1/me/photo').set('Cookie', admin.cookies).expect(404);

    const stored = await request(server())
      .post('/api/v1/me/photo')
      .set('Cookie', admin.cookies)
      .set('x-csrf-token', admin.csrf)
      .attach('file', png, { filename: 'me.png', contentType: 'image/png' })
      .expect(201);
    expect(dataOf<{ mediaType: string }>(stored).mediaType).toBe('image/png');

    const after = await request(server()).get('/api/v1/me').set('Cookie', admin.cookies);
    expect(dataOf<{ hasPhoto: boolean }>(after).hasPhoto).toBe(true);

    const own = await request(server())
      .get('/api/v1/me/photo')
      .set('Cookie', admin.cookies)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(own.headers['content-type']).toBe('image/png');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(own.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect((own.body as Buffer).equals(png)).toBe(true);

    await request(server())
      .get(`/api/v1/users/${adminId}/photo`)
      .set('Cookie', admin.cookies)
      .expect(200);
  }, 30_000);

  it('refuses a profile photo that is not an image, empty, or too large', async () => {
    const admin = await login('admin@dts.local', ADMIN_PASSWORD);
    const post = (buffer: Buffer, filename: string, contentType: string) =>
      request(server())
        .post('/api/v1/me/photo')
        .set('Cookie', admin.cookies)
        .set('x-csrf-token', admin.csrf)
        .attach('file', buffer, { filename, contentType });

    // A script renamed to .png, declared as an image: the bytes decide, not the name.
    const spoofed = await post(Buffer.from('<script>alert(1)</script>'), 'me.png', 'image/png');
    expect(spoofed.status).toBe(415);
    expect(spoofed.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');

    const empty = await post(Buffer.alloc(0), 'empty.png', 'image/png');
    expect(empty.status).toBe(400);

    const huge = await post(Buffer.alloc(2 * 1024 * 1024 + 1), 'huge.png', 'image/png');
    expect(huge.status).toBe(413);

    await request(server())
      .post('/api/v1/me/photo')
      .set('Cookie', admin.cookies)
      .set('x-csrf-token', admin.csrf)
      .expect(400);
  }, 30_000);

  it('records auth and admin actions in an audit trail only administrators may read', async () => {
    const admin = await login('admin@dts.local', ADMIN_PASSWORD);

    const events = await request(server())
      .get('/api/v1/audit-events')
      .set('Cookie', admin.cookies)
      .expect(200);
    const page = dataOf<{ items: { action: string }[]; total: number }>(events);
    expect(page.items.map((row) => row.action)).toContain('auth.login');
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
  }, 30_000);

  it('filters the audit trail by user, action, date range, and paginates', async () => {
    const admin = await login('admin@dts.local', ADMIN_PASSWORD);
    const query = (params: string) =>
      request(server())
        .get(`/api/v1/audit-events${params}`)
        .set('Cookie', admin.cookies)
        .expect(200);

    interface Page {
      items: { id: string; action: string; actorId: string }[];
      total: number;
      limit: number;
      offset: number;
    }

    // action filter: every returned row matches the requested action, and the total describes
    // the filtered set rather than the whole trail.
    const byAction = dataOf<Page>(await query('?action=auth.login'));
    expect(byAction.items.length).toBeGreaterThan(0);
    expect(byAction.items.every((row) => row.action === 'auth.login')).toBe(true);
    expect(byAction.total).toBe(byAction.items.length);

    // user filter (alias for actorId): the login events belong to the admin actor.
    const adminActorId = byAction.items[0]!.actorId;
    const byUser = dataOf<Page>(await query(`?user=${adminActorId}`));
    expect(byUser.items.length).toBeGreaterThan(0);
    expect(byUser.items.every((row) => row.actorId === adminActorId)).toBe(true);

    // date range: a window ending in the future includes recent rows; one starting in the
    // future excludes them (from inclusive, to exclusive).
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const past = new Date(Date.now() - 3_600_000).toISOString();
    expect(dataOf<Page>(await query(`?from=${past}&to=${future}`)).items.length).toBeGreaterThan(0);
    const none = dataOf<Page>(await query(`?from=${future}`));
    expect(none.items).toHaveLength(0);
    expect(none.total).toBe(0);

    // pagination: limit caps the page, the total still counts the whole match, and offset skips
    // into the ordered result.
    const firstPage = dataOf<Page>(await query('?limit=1'));
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.limit).toBe(1);
    expect(firstPage.total).toBeGreaterThan(1);
    const secondPage = dataOf<Page>(await query('?limit=1&offset=1'));
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.offset).toBe(1);
    expect(secondPage.items[0]!.id).not.toBe(firstPage.items[0]!.id);

    // a malformed date is rejected rather than silently ignored.
    await request(server())
      .get('/api/v1/audit-events?from=not-a-date')
      .set('Cookie', admin.cookies)
      .expect(400);
  }, 30_000);
});
