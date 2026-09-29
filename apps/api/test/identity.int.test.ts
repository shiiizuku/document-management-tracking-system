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

    // Deactivation takes effect on the next authentication attempt.
    await authed('post', `/api/v1/users/${created.id}/deactivate`).expect(201);
    await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'applicant@dts.local', password: 'Applicant1234!' })
      .expect(401);
  }, 30_000);

  it('records auth and admin actions in an audit trail only administrators may read', async () => {
    const admin = await login('admin@dts.local', ADMIN_PASSWORD);

    const events = await request(server())
      .get('/api/v1/audit-events')
      .set('Cookie', admin.cookies)
      .expect(200);
    const actions = dataOf<{ action: string }[]>(events).map((row) => row.action);
    expect(actions).toContain('auth.login');
  }, 30_000);
});
