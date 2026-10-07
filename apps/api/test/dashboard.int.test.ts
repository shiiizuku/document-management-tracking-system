import 'reflect-metadata';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { eq, sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { Database } from '../src/database/client.js';
import { divisions, documents, sections } from '../src/database/schema.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive dashboard int test');

const RECORDS_PASSWORD = 'RecordsPass1234!';
const STAFF_PASSWORD = 'StaffPass12345!';
const HEAD_PASSWORD = 'BetaHeadPass12!';

// Two divisions, so "pending by division" has something to divide. The staff member sits in one
// section of DIV_A and can therefore see strictly less than the records officer.
const DIV_A = '00000000-0000-4000-9000-0000000000d0';
const DIV_B = '00000000-0000-4000-9000-0000000000d1';
const SEC_A = '00000000-0000-4000-9000-0000000000d2';

interface Session {
  cookies: string[];
}
const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

interface DivisionPending {
  divisionId: string;
  divisionName: string;
  total: number;
}
interface ActivityEntry {
  id: string;
  documentId: string;
  trackingNumber: string;
  action: string;
  actorName: string;
  occurredAt: string;
}
interface Summary {
  total: number;
  byStatus: Record<string, number>;
  overdue: number;
  pendingByDivision: DivisionPending[];
  recentActivity: ActivityEntry[];
}

/**
 * The dashboard's whole claim is that its numbers are the same numbers the registry would show.
 * These tests assert that against real Postgres by asking both endpoints the same question as the
 * same user — a chart built from a second, slightly different query would pass a unit test and
 * still disagree with the list the user clicks through to.
 */
describe('scoped dashboard summary against real Postgres', () => {
  let app: INestApplication;
  let records: Session;
  let staff: Session;
  let betaHead: Session;
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

  const createDoc = async (divisionId: string, sectionId: string | undefined, title: string) =>
    dataOf<{ id: string; version: number; trackingNumber: string }>(
      await request(server())
        .post('/api/v1/documents')
        .set('Cookie', records.cookies)
        .send({
          title,
          type: 'LETTER',
          priority: 'NORMAL',
          direction: 'INCOMING',
          sender: 'External',
          divisionId,
          ...(sectionId === undefined ? {} : { sectionId }),
        })
        .expect(201),
    );

  const summaryFor = async (session: Session): Promise<Summary> =>
    dataOf<Summary>(
      await request(server())
        .get('/api/v1/dashboard/summary')
        .set('Cookie', session.cookies)
        .expect(200),
    );

  /** The registry's own answer to "how many PENDING documents in this division", for comparison. */
  const listedPendingIn = async (session: Session, divisionId: string): Promise<number> =>
    dataOf<{ total: number }>(
      await request(server())
        .get(`/api/v1/documents?status=PENDING&divisionId=${divisionId}&pageSize=1`)
        .set('Cookie', session.cookies)
        .expect(200),
    ).total;

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
    await database.insert(divisions).values([
      { id: DIV_A, code: 'DASHA', name: 'Alpha Division' },
      { id: DIV_B, code: 'DASHB', name: 'Beta Division' },
    ]);
    await database
      .insert(sections)
      .values({ id: SEC_A, divisionId: DIV_A, code: 'A1', name: 'Alpha Section' });

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
    await users.insert({
      email: 'staff@dts.local',
      displayName: 'Alpha Staff',
      passwordHash: hashSync(STAFF_PASSWORD, 4),
      role: 'STAFF_MEMBER',
      divisionId: DIV_A,
      sectionId: SEC_A,
      canAccessConfidential: false,
    });
    /*
     * Beta's own head. Needed because accepting custody is positional: only the unit a hop was
     * handed to can take it on, so there is no way to produce a workflow event on a Beta document
     * without someone in Beta — the records officer has office-wide *read* scope and no placement.
     */
    await users.insert({
      email: 'beta-head@dts.local',
      displayName: 'Beta Head',
      passwordHash: hashSync(HEAD_PASSWORD, 4),
      role: 'DIVISION_HEAD',
      divisionId: DIV_B,
      sectionId: null,
      canAccessConfidential: false,
    });

    records = await login('records@dts.local', RECORDS_PASSWORD);
    staff = await login('staff@dts.local', STAFF_PASSWORD);
    betaHead = await login('beta-head@dts.local', HEAD_PASSWORD);

    // Two pending in Alpha/Alpha Section, one pending in Beta. Everything is registered by the
    // records officer, who works across the whole office.
    await createDoc(DIV_A, SEC_A, 'Alpha one');
    await createDoc(DIV_A, SEC_A, 'Alpha two');
    await createDoc(DIV_B, undefined, 'Beta one');
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('breaks the pending queue down by the division holding it', async () => {
    const summary = await summaryFor(records);
    const byName = Object.fromEntries(
      summary.pendingByDivision.map((row) => [row.divisionName, row.total]),
    );
    expect(byName).toEqual({ 'Alpha Division': 2, 'Beta Division': 1 });
  });

  /*
   * The acceptance condition for this change. Each division's count must equal what the registry
   * reports for the same filter, as the same user — that is what makes the chart clickable rather
   * than merely decorative.
   */
  it('reconciles every division count with the filtered registry list', async () => {
    const summary = await summaryFor(records);
    for (const row of summary.pendingByDivision) {
      expect(await listedPendingIn(records, row.divisionId)).toBe(row.total);
    }
    // And the parts add up to the status tile above them.
    const charted = summary.pendingByDivision.reduce((sum, row) => sum + row.total, 0);
    expect(charted).toBe(summary.byStatus.PENDING);
  });

  /*
   * The same predicate, a narrower actor. A staff member in one section of Alpha must not learn
   * from the chart that Beta is holding work they cannot open.
   */
  it('shows a section-scoped user only their own division, and reconciles there too', async () => {
    const summary = await summaryFor(staff);
    expect(summary.pendingByDivision.map((row) => row.divisionName)).toEqual(['Alpha Division']);
    expect(summary.pendingByDivision[0]?.total).toBe(2);
    expect(await listedPendingIn(staff, DIV_A)).toBe(2);
    expect(summary.byStatus.PENDING).toBe(2);
  });

  it('feeds recent activity, newest first, naming who acted', async () => {
    const target = await createDoc(DIV_A, SEC_A, 'Alpha three');
    // Accepted by Alpha's own staff: only the unit a hop was handed to can take it on.
    await request(server())
      .post(`/api/v1/documents/${target.id}/actions/ACCEPT`)
      .set('Cookie', staff.cookies)
      .send({ expectedVersion: target.version })
      .expect(201);

    const summary = await summaryFor(records);
    const newest = summary.recentActivity[0];
    expect(newest).toMatchObject({
      documentId: target.id,
      trackingNumber: target.trackingNumber,
      action: 'ACCEPT',
      actorName: 'Alpha Staff',
    });

    const timestamps = summary.recentActivity.map((entry) => Date.parse(entry.occurredAt));
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });

  /*
   * The feed is a list of documents by another name, so it carries the same disclosure risk as the
   * registry and must be scoped identically. A staff member in Alpha must never see Beta's events.
   */
  it('never names a document in the feed that the actor could not open', async () => {
    const beta = await createDoc(DIV_B, undefined, 'Beta two');
    await request(server())
      .post(`/api/v1/documents/${beta.id}/actions/ACCEPT`)
      .set('Cookie', betaHead.cookies)
      .send({ expectedVersion: beta.version })
      .expect(201);

    const forRecords = await summaryFor(records);
    expect(forRecords.recentActivity.some((entry) => entry.documentId === beta.id)).toBe(true);

    const forStaff = await summaryFor(staff);
    expect(forStaff.recentActivity.some((entry) => entry.documentId === beta.id)).toBe(false);
    // And the staff member confirms it the hard way: the document itself is unreachable.
    await request(server())
      .get(`/api/v1/documents/${beta.id}`)
      .set('Cookie', staff.cookies)
      .expect(404);
  });

  it('caps the feed rather than returning an unbounded log', async () => {
    const summary = await summaryFor(records);
    expect(summary.recentActivity.length).toBeLessThanOrEqual(10);
  });

  /*
   * The Overdue tile is a link to `/documents?overdue=true`, so the two must count the same rows.
   * Both compose `documentIsOverdue`; this proves it end to end, as two differently scoped users,
   * with an overdue document in each division, one with a future due date, and one past due but
   * archived (which is closed, so not overdue).
   *
   * Due dates and the archived status are written straight to the row, so the test needs neither a
   * clock nor a walk through the whole workflow to reach ARCHIVED; what is under test is the read
   * side. Declared last, so the extra documents cannot disturb the counts above.
   */
  it('reconciles the Overdue tile with the overdue-filtered registry list', async () => {
    const database = app.get<Database>(DATABASE);
    const past = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const alphaLate = await createDoc(DIV_A, SEC_A, 'Alpha late');
    const alphaOnTime = await createDoc(DIV_A, SEC_A, 'Alpha on time');
    const betaLate = await createDoc(DIV_B, undefined, 'Beta late');
    const betaClosed = await createDoc(DIV_B, undefined, 'Beta closed');
    await database.update(documents).set({ dueAt: past }).where(eq(documents.id, alphaLate.id));
    await database.update(documents).set({ dueAt: future }).where(eq(documents.id, alphaOnTime.id));
    await database.update(documents).set({ dueAt: past }).where(eq(documents.id, betaLate.id));
    await database
      .update(documents)
      .set({ dueAt: past, status: 'ARCHIVED' })
      .where(eq(documents.id, betaClosed.id));

    const listedOverdue = async (session: Session) =>
      dataOf<{ total: number; items: { id: string }[] }>(
        await request(server())
          .get('/api/v1/documents?overdue=true')
          .set('Cookie', session.cookies)
          .expect(200),
      );

    const forRecords = await listedOverdue(records);
    expect(forRecords.items.map((item) => item.id).sort()).toEqual(
      [alphaLate.id, betaLate.id].sort(),
    );
    expect((await summaryFor(records)).overdue).toBe(forRecords.total);

    // Scope still applies on top: the Alpha staff member sees only Alpha's late document.
    const forStaff = await listedOverdue(staff);
    expect(forStaff.items.map((item) => item.id)).toEqual([alphaLate.id]);
    expect((await summaryFor(staff)).overdue).toBe(forStaff.total);

    // `overdue=false` is no filter at all, and a value that is not a boolean is refused.
    const unfiltered = dataOf<{ total: number }>(
      await request(server())
        .get('/api/v1/documents?overdue=false&pageSize=1')
        .set('Cookie', records.cookies)
        .expect(200),
    );
    expect(unfiltered.total).toBe((await summaryFor(records)).total);
    await request(server())
      .get('/api/v1/documents?overdue=soon')
      .set('Cookie', records.cookies)
      .expect(400);
  });
});
