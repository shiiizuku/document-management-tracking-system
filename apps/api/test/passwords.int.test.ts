import 'reflect-metadata';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Response } from 'express';
import request from 'supertest';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { Database } from '../src/database/client.js';
import { auditEvents } from '../src/database/schema.js';
import { SessionService } from '../src/modules/auth/session.service.js';
import { UsersRepository, type UserRow } from '../src/modules/users/users.repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive passwords int test');

const ADMIN_PASSWORD = 'AdminPass1234!';
const STAFF_PASSWORD = 'StaffPass1234!';
const NEW_PASSWORD = 'Fresh-Passw0rd-2026';

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
  if (csrfPair === undefined) throw new Error('response did not set a CSRF cookie');
  return { cookies, csrf: csrfPair.slice('dts_csrf='.length) };
};

/**
 * Risk R-22: a password change, an administrator reset, a deactivation and a reactivation each
 * end the sessions the user already holds, through the `session_version` counter.
 *
 * Its own suite, with its own app, because sign-in is limited to five attempts a minute per
 * client and the identity suite already spends most of that. Most sessions here are minted with
 * `SessionService.issue`, which is exactly what sign-in does once the password has checked out;
 * the real sign-in route is used only where the password itself is what is being tested.
 */
describe('password change, reset and session revocation against a real database', () => {
  let app: INestApplication;
  let database: Database;
  let users: UsersRepository;
  let admin: UserRow;
  const server = (): Server => app.getHttpServer() as Server;

  const insertUser = (email: string, role: UserRow['role'], password: string) =>
    users.insert({
      email,
      displayName: email,
      passwordHash: hashSync(password, 4),
      role,
      divisionId: null,
      sectionId: null,
      canAccessConfidential: false,
    });

  /** A session for the user as they stand now, as sign-in would issue it. */
  const sessionFor = async (userId: string): Promise<Session> => {
    const row = await users.findById(userId);
    if (row === null) throw new Error(`no user ${userId}`);
    const cookies: string[] = [];
    let csrf = '';
    const response = {
      cookie: (name: string, value: string) => {
        cookies.push(`${name}=${value}`);
        if (name === 'dts_csrf') csrf = value;
      },
    } as unknown as Response;
    app.get(SessionService).issue(response, row.id, row.sessionVersion);
    return { cookies, csrf };
  };

  const probe = (session: Session) =>
    request(server()).get('/api/v1/auth/me').set('Cookie', session.cookies);

  const post = (session: Session, path: string) =>
    request(server()).post(path).set('Cookie', session.cookies).set('x-csrf-token', session.csrf);

  const signIn = (email: string, password: string) =>
    request(server()).post('/api/v1/auth/login').send({ email, password });

  const auditFor = (action: string, targetId: string) =>
    database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, action), eq(auditEvents.targetId, targetId)));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    await app.init();

    database = app.get<Database>(DATABASE);
    await database.execute(
      sql.raw(
        'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      ),
    );
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
    users = app.get(UsersRepository);
    admin = await insertUser('admin@dts.local', 'ADMINISTRATOR', ADMIN_PASSWORD);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('changes your own password, keeping this session and ending every other one', async () => {
    const staff = await insertUser('changer@dts.local', 'STAFF_MEMBER', STAFF_PASSWORD);
    const here = await sessionFor(staff.id);
    const elsewhere = await sessionFor(staff.id);

    const changed = await post(here, '/api/v1/me/password')
      .send({ currentPassword: STAFF_PASSWORD, newPassword: NEW_PASSWORD })
      .expect(204);

    // The caller is re-issued a session under the new version, so they stay signed in…
    const reissued = readSession(changed);
    await probe(reissued).expect(200);
    // …while the session they changed it from, and every other one, is finished.
    await probe(here).expect(401);
    await probe(elsewhere).expect(401);

    await signIn('changer@dts.local', STAFF_PASSWORD).expect(401);
    await signIn('changer@dts.local', NEW_PASSWORD).expect(201);

    const [event] = await auditFor('user.password-changed', staff.id);
    expect(event).toMatchObject({ actorId: staff.id, outcome: 'SUCCESS' });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(STAFF_PASSWORD);
    expect(serialized).not.toContain(NEW_PASSWORD);
  }, 30_000);

  it('refuses a wrong current password or a weak new one, and changes nothing', async () => {
    const staff = await insertUser('careful@dts.local', 'STAFF_MEMBER', STAFF_PASSWORD);
    const session = await sessionFor(staff.id);

    const wrong = await post(session, '/api/v1/me/password')
      .send({ currentPassword: 'Not-The-Passw0rd!', newPassword: NEW_PASSWORD })
      .expect(400);
    expect((wrong.body as { error: { code: string } }).error.code).toBe(
      'CURRENT_PASSWORD_INCORRECT',
    );
    await post(session, '/api/v1/me/password')
      .send({ currentPassword: STAFF_PASSWORD, newPassword: 'short' })
      .expect(400);

    // Neither attempt ended the session or moved the password.
    await probe(session).expect(200);
    const row = await users.findById(staff.id);
    expect(row?.sessionVersion).toBe(staff.sessionVersion);

    const [refusal] = await auditFor('user.password-changed', staff.id);
    expect(refusal).toMatchObject({ outcome: 'FAILURE' });
  }, 30_000);

  it('lets an administrator reset a password, ending the sessions and clearing a lockout', async () => {
    const staff = await insertUser('forgetful@dts.local', 'STAFF_MEMBER', STAFF_PASSWORD);
    await users.update(staff.id, {
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 15 * 60 * 1000),
    });
    const theirs = await sessionFor(staff.id);
    const administrator = await sessionFor(admin.id);

    await post(administrator, `/api/v1/users/${staff.id}/password`)
      .send({ password: NEW_PASSWORD })
      .expect(204);

    await probe(theirs).expect(401);
    // The lockout went with the old password, so the new one opens the account at once.
    await signIn('forgetful@dts.local', NEW_PASSWORD).expect(201);

    const [event] = await auditFor('user.password-reset', staff.id);
    expect(event).toMatchObject({ actorId: admin.id, outcome: 'SUCCESS' });
    expect(JSON.stringify(event)).not.toContain(NEW_PASSWORD);
  }, 30_000);

  it('refuses a reset to anyone without user management, and to an administrator on themselves', async () => {
    const staff = await insertUser('nosy@dts.local', 'STAFF_MEMBER', STAFF_PASSWORD);
    const staffSession = await sessionFor(staff.id);
    const administrator = await sessionFor(admin.id);

    await post(staffSession, `/api/v1/users/${admin.id}/password`)
      .send({ password: NEW_PASSWORD })
      .expect(403);
    // An administrator changes their own password through /me/password, which asks for the
    // current one. The reset route does not, so it must not work on oneself.
    await post(administrator, `/api/v1/users/${admin.id}/password`)
      .send({ password: NEW_PASSWORD })
      .expect(403);
    await post(administrator, `/api/v1/users/${staff.id}/password`)
      .send({ password: 'weak' })
      .expect(400);

    await probe(administrator).expect(200);
  }, 30_000);

  it('no longer revives old sessions when an account is reactivated', async () => {
    const staff = await insertUser('returning@dts.local', 'STAFF_MEMBER', STAFF_PASSWORD);
    const before = await sessionFor(staff.id);
    const administrator = await sessionFor(admin.id);

    await post(administrator, `/api/v1/users/${staff.id}/deactivate`).expect(201);
    await probe(before).expect(401);
    await post(administrator, `/api/v1/users/${staff.id}/reactivate`).expect(201);

    // This is the E1 drill's finding: the old session answered 200 again here.
    await probe(before).expect(401);
    await probe(await sessionFor(staff.id)).expect(200);
  }, 30_000);
});
