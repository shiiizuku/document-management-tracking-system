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
import { divisions, notifications, sections } from '../src/database/schema.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive documents int test');

const RECORDS_PASSWORD = 'RecordsPass1234!';
const STAFF_PASSWORD = 'StaffPass12345!';
const ADMIN_PASSWORD = 'AdminPass12345!';
const HEAD_PASSWORD = 'HeadPass123456!';

const DIV_A = '00000000-0000-4000-9000-0000000000a0';
const DIV_B = '00000000-0000-4000-9000-0000000000b0';
// A third division, consulted for information. It has a head so the notification a copy writes
// has a recipient, but nobody signs in as it — the forwarding assertions read its rows directly,
// which keeps this suite inside the 5-per-minute login window.
const DIV_C = '00000000-0000-4000-9000-0000000000c0';
const SEC_A = '00000000-0000-4000-9000-0000000000a1';
const SEC_B = '00000000-0000-4000-9000-0000000000b1';

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

interface DocumentPayload {
  id: string;
  trackingNumber: string;
  referenceNumber: string | null;
  status: string;
  version: number;
}

describe('document registry REST against a real database', () => {
  let app: INestApplication;
  let staffId: string;
  let headId: string;
  let divCHeadId: string;
  // The auth window is a tight 5/minute, so each principal signs in once in `beforeAll` and
  // the session is reused across tests rather than logging in per case.
  let records: Session;
  let staff: Session;
  let admin: Session;
  // A Division A head: the lowest-privileged role that holds REPORT_VIEW, and therefore the one
  // that exercises reporting over a scope narrower than the whole office.
  let head: Session;
  const server = (): Server => app.getHttpServer() as Server;

  const login = async (email: string, password: string): Promise<Session> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return readSession(response);
  };

  const registerDocument = (session: Session, body: Record<string, unknown>): request.Test =>
    request(server())
      .post('/api/v1/documents')
      .set('Cookie', session.cookies)
      .set('x-csrf-token', session.csrf)
      .send(body);

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
      { id: DIV_A, code: 'DIVA', name: 'Division A' },
      { id: DIV_B, code: 'DIVB', name: 'Division B' },
      { id: DIV_C, code: 'DIVC', name: 'Division C' },
    ]);
    await database.insert(sections).values([
      { id: SEC_A, divisionId: DIV_A, code: 'A1', name: 'Section A1' },
      { id: SEC_B, divisionId: DIV_B, code: 'B1', name: 'Section B1' },
    ]);

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
      displayName: 'Division A Staff',
      passwordHash: hashSync(STAFF_PASSWORD, 4),
      role: 'STAFF_MEMBER',
      divisionId: DIV_A,
      sectionId: SEC_A,
      canAccessConfidential: false,
    });
    staffId = staffUser.id;
    const headUser = await users.insert({
      email: 'head@dts.local',
      displayName: 'Division A Head',
      passwordHash: hashSync(HEAD_PASSWORD, 4),
      role: 'DIVISION_HEAD',
      divisionId: DIV_A,
      sectionId: null,
      canAccessConfidential: false,
    });
    headId = headUser.id;
    const divCHeadUser = await users.insert({
      email: 'div-c-head@dts.local',
      displayName: 'Division C Head',
      passwordHash: hashSync(HEAD_PASSWORD, 4),
      role: 'DIVISION_HEAD',
      divisionId: DIV_C,
      sectionId: null,
      canAccessConfidential: false,
    });
    divCHeadId = divCHeadUser.id;
    await users.insert({
      email: 'admin@dts.local',
      displayName: 'System Administrator',
      passwordHash: hashSync(ADMIN_PASSWORD, 4),
      role: 'ADMINISTRATOR',
      divisionId: null,
      sectionId: null,
      canAccessConfidential: true,
    });

    records = await login('records@dts.local', RECORDS_PASSWORD);
    staff = await login('staff@dts.local', STAFF_PASSWORD);
    admin = await login('admin@dts.local', ADMIN_PASSWORD);
    head = await login('head@dts.local', HEAD_PASSWORD);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('registers incoming and outgoing documents, allocating a reference only for outgoing', async () => {
    const incoming = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Incoming letter',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External Office',
        referenceNumber: 'EXT-2026-42',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );
    expect(incoming.trackingNumber).toMatch(/^DTS-\d{4}-\d{6}$/);
    // Incoming keeps whatever external reference the sender used.
    expect(incoming.referenceNumber).toBe('EXT-2026-42');
    expect(incoming).toMatchObject({ status: 'IN_PROCESS', version: 1 });

    const outgoing = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Outgoing memo',
        type: 'MEMORANDUM',
        priority: 'HIGH',
        direction: 'OUTGOING',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );
    // Outgoing is stamped with an office reference prefixed by the division code.
    expect(outgoing.referenceNumber).toMatch(/^DIVA-\d{4}-\d{5}$/);

    // Both are retrievable by tracking id.
    const fetched = await request(server())
      .get(`/api/v1/documents/${incoming.id}`)
      .set('Cookie', records.cookies)
      .expect(200);
    expect(dataOf<DocumentPayload>(fetched).trackingNumber).toBe(incoming.trackingNumber);
  }, 30_000);

  it('allocates a unique reference number to every one of many concurrent outgoing creates', async () => {
    const parallel = 12;
    const responses = await Promise.all(
      Array.from({ length: parallel }, (_, index) =>
        registerDocument(records, {
          title: `Concurrent outgoing ${index}`,
          type: 'MEMORANDUM',
          priority: 'NORMAL',
          direction: 'OUTGOING',
          divisionId: DIV_B,
          sectionId: SEC_B,
        }).expect(201),
      ),
    );
    const references = responses.map(
      (response) => dataOf<DocumentPayload>(response).referenceNumber,
    );
    const trackingNumbers = responses.map((r) => dataOf<DocumentPayload>(r).trackingNumber);
    expect(new Set(references).size).toBe(parallel);
    // Tracking numbers are office-wide unique too.
    expect(new Set(trackingNumbers).size).toBe(parallel);
  }, 30_000);

  it('records a metadata edit as history and rejects a stale edit with 409', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Original title',
        type: 'LETTER',
        priority: 'LOW',
        direction: 'INCOMING',
        sender: 'Someone',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );

    const edit = (expectedVersion: number, title: string) =>
      request(server())
        .patch(`/api/v1/documents/${created.id}/metadata`)
        .set('Cookie', records.cookies)
        .set('x-csrf-token', records.csrf)
        .send({ expectedVersion, title });

    const updated = dataOf<DocumentPayload>(await edit(1, 'Revised title').expect(200));
    expect(updated.version).toBe(2);

    const revisions = await request(server())
      .get(`/api/v1/documents/${created.id}/metadata-revisions`)
      .set('Cookie', records.cookies)
      .expect(200);
    const history =
      dataOf<{ before: Record<string, unknown>; after: Record<string, unknown> }[]>(revisions);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      before: { title: 'Original title' },
      after: { title: 'Revised title' },
    });

    // The editor who still holds version 1 loses the optimistic-concurrency race.
    const conflict = await edit(1, 'Late title').expect(409);
    expect(conflict.body.error.code).toBe('DOCUMENT_CONFLICT');
  }, 30_000);

  it('keeps cross-scope documents out of a staff member’s search results and totals', async () => {
    await registerDocument(records, {
      title: 'Division B only secret plan',
      type: 'MEMORANDUM',
      priority: 'NORMAL',
      direction: 'INCOMING',
      sender: 'External',
      divisionId: DIV_B,
      sectionId: SEC_B,
    }).expect(201);

    const search = await request(server())
      .get('/api/v1/documents?search=Division%20B%20only%20secret%20plan')
      .set('Cookie', staff.cookies)
      .expect(200);
    const result = dataOf<{ total: number; items: unknown[] }>(search);
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  }, 30_000);

  it('persists a workflow transition with its timeline and enforces optimistic concurrency', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Workflow subject',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );

    /*
     * Accepted by the division's own staff, not by the records officer who registered it.
     * Registration hands the document to a unit; that unit takes it on (decisions 154–156), and
     * the records officer — who has no placement — is the recipient of nothing.
     */
    const accept = (expectedVersion: number) =>
      request(server())
        .post(`/api/v1/documents/${created.id}/actions/ACCEPT`)
        .set('Cookie', staff.cookies)
        .set('x-csrf-token', staff.csrf)
        .send({ expectedVersion });

    const refusedForRecords = await request(server())
      .post(`/api/v1/documents/${created.id}/actions/ACCEPT`)
      .set('Cookie', records.cookies)
      .set('x-csrf-token', records.csrf)
      .send({ expectedVersion: 1 })
      .expect(422);
    expect(refusedForRecords.body.error.code).toBe('ROUTE_NOT_FOR_ACTOR');

    const accepted = dataOf<DocumentPayload>(await accept(1).expect(201));
    /*
     * Accepting stamps the route row, so the document itself is untouched: the status was already
     * IN_PROCESS from registration and the version does not move (ADR-0005). What changes is that
     * the hop is no longer outstanding, which is what the derived `PENDING` reads.
     */
    expect(accepted).toMatchObject({ status: 'IN_PROCESS', version: 1 });

    const detail = await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', records.cookies)
      .expect(200);
    const timeline = dataOf<{ timeline: { action: string; toStatus: string }[] }>(detail).timeline;
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ action: 'ACCEPT', toStatus: 'IN_PROCESS' });

    const routes = dataOf<{ routes: { acceptedAt: string | null }[] }>(detail).routes;
    expect(routes).toHaveLength(1);
    expect(routes[0]?.acceptedAt).not.toBeNull();

    /*
     * Replaying the accept is a rule violation, not a version conflict. The version is unchanged
     * — so there is nothing stale about the request — and the thing that stops it is the route
     * row already carrying a received timestamp, which must not be overwritten: it is evidence
     * printed on a slip that travelled with a physical document.
     */
    const replayed = await accept(1).expect(422);
    expect(replayed.body.error.code).toBe('ROUTE_ALREADY_ACCEPTED');
  }, 30_000);

  it('lets an assignment reach a document a staff member is otherwise out of scope for', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Cross-division assignment',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_B,
        sectionId: SEC_B,
      }).expect(201),
    );

    // Out of scope before the assignment: a Division A staff member cannot see a Division B doc.
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', staff.cookies)
      .expect(404);

    await request(server())
      .post(`/api/v1/documents/${created.id}/assignments`)
      .set('Cookie', records.cookies)
      .set('x-csrf-token', records.csrf)
      .send({ recipientUserId: staffId })
      .expect(201);

    // The assignment now brings the document into the staff member's readable scope.
    const readable = await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', staff.cookies)
      .expect(200);
    expect(dataOf<DocumentPayload>(readable).id).toBe(created.id);
  }, 30_000);

  /*
   * D-33 over an export: the monthly report has to agree with the registry about what the actor
   * can see, in both directions. Out of scope must stay out, but *reachable* must stay in — and
   * the second half is the one with no natural alarm, because a report that is quietly short a row
   * looks exactly like a report.
   *
   * The case is specific: a document reachable only by assignment, from another division. It is
   * the one `documentScopeFor` admits through a path the row's own columns do not show, so any
   * attempt to re-decide readability downstream from a projection — the report's rows carry no
   * assignment membership — would drop it. A division head is the actor because DIVISION_HEAD is
   * the lowest-privileged role holding REPORT_VIEW, and so the only one whose report is narrower
   * than the whole office.
   */
  it('counts a cross-division assignment on the assignee’s monthly report', async () => {
    const now = new Date();
    const [year, month] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Cross-division report row',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_B,
        sectionId: SEC_B,
      }).expect(201),
    );

    const reportFor = async (session: Session) =>
      dataOf<{ totals: { total: number }; documents: { id: string }[] }>(
        await request(server())
          .get(`/api/v1/reports/monthly?year=${year}&month=${month}`)
          .set('Cookie', session.cookies)
          .expect(200),
      );

    // Division B's document is outside a Division A head's scope until something reaches it.
    const before = await reportFor(head);
    expect(before.documents.map((row) => row.id)).not.toContain(created.id);

    await request(server())
      .post(`/api/v1/documents/${created.id}/assignments`)
      .set('Cookie', records.cookies)
      .set('x-csrf-token', records.csrf)
      .send({ recipientUserId: headId })
      .expect(201);

    const after = await reportFor(head);
    expect(after.documents.map((row) => row.id)).toContain(created.id);
    // The totals are computed from the same list, so they move with it or the report contradicts
    // its own rows.
    expect(after.totals.total).toBe(before.totals.total + 1);
  }, 30_000);

  it('routes a document to another division without moving its registering placement', async () => {
    // Registered in Division A / Section A, where the staff member can see it.
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'To be forwarded',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', staff.cookies)
      .expect(200);

    const routed = dataOf<
      DocumentPayload & {
        divisionId: string;
        sectionId: string | null;
        routes: { toDivisionId: string; toSectionId: string | null; forInformation: boolean }[];
      }
    >(
      await request(server())
        .post(`/api/v1/documents/${created.id}/routes`)
        .set('Cookie', records.cookies)
        .set('x-csrf-token', records.csrf)
        .send({
          expectedVersion: 1,
          toDivisionId: DIV_B,
          toSectionId: SEC_B,
          forInformationDivisionIds: [DIV_C],
          remarks: 'Please handle',
        })
        .expect(201),
    );
    /*
     * The assertion this test exists for, and the reverse of what it asserted before slice 4:
     * forwarding is non-destructive (ADR-0005), so the columns still name Division A / Section A,
     * where the document was *registered*. Where it has gone is a route row.
     */
    expect(routed.divisionId).toBe(DIV_A);
    expect(routed.sectionId).toBe(SEC_A);
    /*
     * Three hops: registration writes the first — handing the document to the division it was
     * registered for, unaccepted, because registering confers no custody (decision 154) — then the
     * forward writes one lead row and one row per division copied in for information.
     */
    expect(routed.routes).toHaveLength(3);
    expect(
      routed.routes.map((hop) => [hop.toDivisionId, hop.toSectionId, hop.forInformation]),
    ).toEqual([
      [DIV_A, SEC_A, false],
      [DIV_B, SEC_B, false],
      [DIV_C, null, true],
    ]);
    // Nothing on the row changed, so the bump is purely the concurrency guard against a second
    // forward racing this one.
    expect(routed.version).toBe(2);

    /*
     * Decision 176: the unit that handled a document keeps it. The forward used to revoke the
     * sender's read — this assertion was a 404 — and now the hop by which Section A received the
     * document is still on record, so Division A's staff can still answer for it.
     */
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', staff.cookies)
      .expect(200);

    // The copy for information notified Division C's head, who is exactly who it made a reader.
    const notified = await app
      .get<Database>(DATABASE)
      .select({ recipientUserId: notifications.recipientUserId, type: notifications.type })
      .from(notifications)
      .where(eq(notifications.documentId, created.id));
    expect(notified).toEqual([{ recipientUserId: divCHeadId, type: 'DOCUMENT_ROUTED' }]);

    // The registry's division filter answers "which documents are at this division", so the
    // forwarded document is listed under B and no longer under A.
    const listedIn = async (divisionId: string): Promise<string[]> =>
      dataOf<{ items: { id: string }[] }>(
        await request(server())
          .get(`/api/v1/documents?divisionId=${divisionId}&pageSize=100`)
          .set('Cookie', records.cookies)
          .expect(200),
      ).items.map((item) => item.id);
    expect(await listedIn(DIV_B)).toContain(created.id);
    expect(await listedIn(DIV_A)).not.toContain(created.id);
  }, 30_000);

  /*
   * The lead recipient is the one the workflow waits on (decision 159), so a forward that named it
   * twice would write one row saying progress is blocked on Division B and one saying it is not.
   * Rejected in the contract rather than in the service, so the client cannot compose it either.
   */
  it('refuses a forward that copies the lead recipient in for information', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Lead copied in',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );
    await request(server())
      .post(`/api/v1/documents/${created.id}/routes`)
      .set('Cookie', records.cookies)
      .set('x-csrf-token', records.csrf)
      .send({
        expectedVersion: 1,
        toDivisionId: DIV_B,
        forInformationDivisionIds: [DIV_C, DIV_B],
      })
      .expect(400);
  }, 30_000);

  /*
   * The no-op check reads current custody, not the column. Forwarding a document back to the
   * division that registered it is a real hop — the ORD sending work back — and would be refused
   * as a no-op by any check that still believed `documents.division_id` was where the document is.
   */
  it('allows a forward back to the registering division', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'There and back',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );
    const forward = (expectedVersion: number, toDivisionId: string, toSectionId?: string) =>
      request(server())
        .post(`/api/v1/documents/${created.id}/routes`)
        .set('Cookie', records.cookies)
        .set('x-csrf-token', records.csrf)
        .send({ expectedVersion, toDivisionId, ...(toSectionId ? { toSectionId } : {}) });

    await forward(1, DIV_B, SEC_B).expect(201);
    // Still a no-op where it genuinely is one: the hop it is sitting at.
    await forward(2, DIV_B, SEC_B).expect(400);
    await forward(2, DIV_A, SEC_A).expect(201);
  }, 30_000);

  it('shares a document with a specific user without moving it', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Shared not moved',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_B,
        sectionId: SEC_B,
      }).expect(201),
    );
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', staff.cookies)
      .expect(404);

    await request(server())
      .post(`/api/v1/documents/${created.id}/shares`)
      .set('Cookie', records.cookies)
      .set('x-csrf-token', records.csrf)
      .send({ userId: staffId })
      .expect(201);

    const readable = await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', staff.cookies)
      .expect(200);
    // Shared, not relocated: it still belongs to Division B.
    expect(dataOf<DocumentPayload & { divisionId: string }>(readable).divisionId).toBe(DIV_B);
  }, 30_000);

  it('surfaces a document on the assignee’s work queue', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'Queue item',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_B,
        sectionId: SEC_B,
      }).expect(201),
    );
    await request(server())
      .post(`/api/v1/documents/${created.id}/assignments`)
      .set('Cookie', records.cookies)
      .set('x-csrf-token', records.csrf)
      .send({ recipientUserId: staffId })
      .expect(201);

    const queue = await request(server())
      .get('/api/v1/documents/assigned')
      .set('Cookie', staff.cookies)
      .expect(200);
    const ids = dataOf<DocumentPayload[]>(queue).map((doc) => doc.id);
    expect(ids).toContain(created.id);
  }, 30_000);

  it('soft-deletes a document (admin only), hides it from reads, then restores it', async () => {
    const created = dataOf<DocumentPayload>(
      await registerDocument(records, {
        title: 'To be deleted',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: DIV_A,
        sectionId: SEC_A,
      }).expect(201),
    );

    const deleteAs = (session: Session, expectedVersion: number) =>
      request(server())
        .delete(`/api/v1/documents/${created.id}`)
        .set('Cookie', session.cookies)
        .set('x-csrf-token', session.csrf)
        .send({ expectedVersion });

    // A records officer has no DOCUMENT_DELETE capability, so the delete is forbidden.
    await deleteAs(records, created.version).expect(403);
    // The document is still readable — the forbidden attempt changed nothing.
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', records.cookies)
      .expect(200);

    // A stale version loses the optimistic-concurrency race even for the admin.
    const conflict = await deleteAs(admin, 999).expect(409);
    expect(conflict.body.error.code).toBe('DOCUMENT_CONFLICT');

    const deleted = dataOf<DocumentPayload>(await deleteAs(admin, created.version).expect(200));
    expect(deleted.version).toBe(created.version + 1);

    // Gone from detail and search once deleted.
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', records.cookies)
      .expect(404);
    const search = await request(server())
      .get('/api/v1/documents?search=To%20be%20deleted')
      .set('Cookie', records.cookies)
      .expect(200);
    expect(dataOf<{ total: number }>(search).total).toBe(0);

    const restoreAs = (session: Session, expectedVersion: number) =>
      request(server())
        .post(`/api/v1/documents/${created.id}/restore`)
        .set('Cookie', session.cookies)
        .set('x-csrf-token', session.csrf)
        .send({ expectedVersion });

    // Restore is admin-only too.
    await restoreAs(records, deleted.version).expect(403);
    const restored = dataOf<DocumentPayload>(await restoreAs(admin, deleted.version).expect(201));
    expect(restored.version).toBe(deleted.version + 1);

    // Readable again after restore.
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', records.cookies)
      .expect(200);

    // Restoring a document that is not deleted is a conflict.
    const notDeleted = await restoreAs(admin, restored.version).expect(409);
    expect(notDeleted.body.error.code).toBe('DOCUMENT_NOT_DELETED');
  }, 30_000);
});
