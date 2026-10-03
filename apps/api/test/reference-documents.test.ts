import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';
import { OutboxWriter } from '../src/modules/audit/outbox.writer.js';
import { DATABASE } from '../src/database/database.constants.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryDocumentsRepository } from './in-memory-documents.repository.js';
import { InMemoryFileVersionsRepository } from './in-memory-file-versions.repository.js';
import { InMemoryOutboxWriter } from './in-memory-outbox.writer.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';
import { fakeTransactionalDatabase } from './test-database.js';

/**
 * Reference Documents over HTTP (decisions 165–167, 178–179).
 *
 * Decision 166 is what most of this file is about: "a reference the reader may not read is
 * indistinguishable from one that does not exist" is a claim about *response bodies*, so the
 * assertions below compare the two responses to each other rather than merely checking that both
 * are 404s. The status is the easy half; the message is where the leak reappears.
 */

interface Summary {
  id: string;
  trackingNumber: string;
  title: string;
  direction: 'INCOMING' | 'OUTGOING';
  status: string;
}

interface Detail {
  id: string;
  status: string;
  version: number;
  referencedDocuments: Summary[];
  replyDocuments: Summary[];
}

const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

/*
 * The error envelope without its correlation id, which is per-request by construction and would
 * make any two responses differ. Everything else — status, code, message, details — is what a
 * caller could read an answer out of, so that is what the indistinguishability cases compare.
 */
const errorOf = (response: { body: unknown }): unknown => {
  // A copy minus the correlation id rather than a hand-picked set of fields: a field added to the
  // envelope later is then compared too, which is the point of the comparison.
  const error = { ...(response.body as { error: Record<string, unknown> }).error };
  delete error.correlationId;
  return error;
};

describe('REST reference documents', () => {
  let app: INestApplication;

  const server = (): Server => app.getHttpServer() as Server;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(UsersRepository)
      .useClass(InMemoryUsersRepository)
      .overrideProvider(AuditWriter)
      .useClass(InMemoryAuditWriter)
      .overrideProvider(DocumentsRepository)
      .useClass(InMemoryDocumentsRepository)
      .overrideProvider(FileVersionsRepository)
      .useClass(InMemoryFileVersionsRepository)
      .overrideProvider(OutboxWriter)
      .useClass(InMemoryOutboxWriter)
      .overrideProvider(DATABASE)
      .useValue(fakeTransactionalDatabase)
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

  const login = async (email: string, password: string): Promise<string[]> =>
    sessionCookie(
      await request(server()).post('/api/v1/auth/login').send({ email, password }).expect(201),
    );

  const asRecords = () => login('records@dts.local', 'Records@1234!');
  const asStaff = () => login('staff@dts.local', 'Staff@12345!');

  const register = async (
    cookie: string[],
    overrides: Record<string, unknown>,
  ): Promise<{ id: string; trackingNumber: string }> => {
    const created = await request(server())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Subject',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        // Required for incoming documents by `createDocumentSchema`; harmless on outgoing ones.
        sender: 'A Correspondent',
        divisionId: 'division-records',
        sectionId: 'section-intake',
        ...overrides,
      })
      .expect(201);
    return created.body.data as { id: string; trackingNumber: string };
  };

  const link = (cookie: string[], outgoingId: string, incomingDocumentId: string) =>
    request(server())
      .post(`/api/v1/documents/${outgoingId}/references`)
      .set('Cookie', cookie)
      .send({ incomingDocumentId });

  const unlink = (cookie: string[], outgoingId: string, incomingDocumentId: string) =>
    request(server())
      .delete(`/api/v1/documents/${outgoingId}/references/${incomingDocumentId}`)
      .set('Cookie', cookie);

  const detail = async (cookie: string[], id: string): Promise<Detail> =>
    (await request(server()).get(`/api/v1/documents/${id}`).set('Cookie', cookie).expect(200)).body
      .data as Detail;

  /*
   * Decision 169 is a records-integrity rule, not a form preference: an outgoing document's
   * reference is allocated from `reference_counters` inside the create transaction and is the
   * identifier printed on a letter that has gone out. The dialog declining to offer the field is
   * courtesy; a rule that lives only in a form holds until somebody uses the API.
   */
  it("refuses to edit an outgoing document's own reference number", async () => {
    const cookie = await asRecords();
    const outgoing = await register(cookie, { direction: 'OUTGOING', title: 'Reply letter' });

    const refused = await request(server())
      .patch(`/api/v1/documents/${outgoing.id}/metadata`)
      .set('Cookie', cookie)
      .send({ expectedVersion: 1, referenceNumber: 'ORD-2026-99999' })
      .expect(400);
    expect((refused.body as { error: { code: string } }).error.code).toBe(
      'REFERENCE_NUMBER_READ_ONLY',
    );

    // The incoming side is unaffected: that string is the sender's, and free text by design.
    const incoming = await register(cookie, { title: 'A request' });
    await request(server())
      .patch(`/api/v1/documents/${incoming.id}/metadata`)
      .set('Cookie', cookie)
      .send({ expectedVersion: 1, referenceNumber: 'THEIR-REF-7' })
      .expect(200);
  });

  it('names two incoming documents, shows the inverse on each, and moves no status', async () => {
    const cookie = await asRecords();
    const outgoing = await register(cookie, { direction: 'OUTGOING', title: 'Reply letter' });
    const first = await register(cookie, { title: 'First request', sender: 'Citizen One' });
    const second = await register(cookie, { title: 'Second request', sender: 'Citizen Two' });

    await link(cookie, outgoing.id, first.id).expect(201);
    const linked = (await link(cookie, outgoing.id, second.id).expect(201)).body.data as Detail;

    expect(linked.referencedDocuments.map((entry) => entry.trackingNumber)).toEqual([
      first.trackingNumber,
      second.trackingNumber,
    ]);
    expect(linked.referencedDocuments.every((entry) => entry.direction === 'INCOMING')).toBe(true);
    // The naming side never shows replies: the relation is directional, which is also why it
    // cannot contain a cycle and needs no guard against one.
    expect(linked.replyDocuments).toEqual([]);

    // The inverse, read from each incoming document as its replies (decision 165).
    for (const incoming of [first, second]) {
      const reply = await detail(cookie, incoming.id);
      expect(reply.replyDocuments.map((entry) => entry.trackingNumber)).toEqual([
        outgoing.trackingNumber,
      ]);
      expect(reply.referencedDocuments).toEqual([]);
      /*
       * Linking a reply is *evidence* of compliance and not the act of it (glossary): some incoming
       * documents need no reply and some need several. Nothing about the status moved, and no
       * version was bumped either — decision 179, the same reasoning as `ACCEPT`.
       */
      expect(reply).toMatchObject({ status: 'IN_PROCESS', version: 1 });
    }
    expect(linked).toMatchObject({ status: 'IN_PROCESS', version: 1 });
  });

  it('answers an unreadable target exactly as it answers one that does not exist', async () => {
    const records = await asRecords();
    const staff = await asStaff();

    // The outgoing document belongs to the staff member's own section, so they may edit it. The
    // incoming one sits in the records section, which they cannot read at all.
    const outgoing = await register(staff, {
      direction: 'OUTGOING',
      title: 'Pilot reply',
      divisionId: 'division-pilot',
      sectionId: 'section-pilot',
    });
    const hidden = await register(records, { title: 'Records-only request' });

    const unreadable = await link(staff, outgoing.id, hidden.id).expect(404);
    const absent = await link(staff, outgoing.id, randomUUID()).expect(404);
    expect(errorOf(unreadable)).toEqual(errorOf(absent));

    /*
     * A 403 here would be the natural thing to write — it is what the capability helpers hand you —
     * and it would turn this endpoint into an existence oracle: "that id is real and you may not
     * see it" is the one answer decision 166 forbids.
     */
    expect(errorOf(unreadable)).toMatchObject({ code: 'HTTP_404', message: 'Document not found' });

    // The unlink path has the same shape and the same trap. The link below is real; the staff
    // member must still not be able to tell it apart from one that was never made.
    await link(records, outgoing.id, hidden.id).expect(201);
    const unlinkUnreadable = await unlink(staff, outgoing.id, hidden.id).expect(404);
    const unlinkAbsent = await unlink(staff, outgoing.id, randomUUID()).expect(404);
    expect(errorOf(unlinkUnreadable)).toEqual(errorOf(unlinkAbsent));

    // And the refused unlink deleted nothing.
    expect((await detail(records, outgoing.id)).referencedDocuments).toHaveLength(1);
  });

  it('omits a confidential reference for an uncleared reader rather than marking its place', async () => {
    const records = await asRecords();
    const staff = await asStaff();

    const pilot = { divisionId: 'division-pilot', sectionId: 'section-pilot' };
    const outgoing = await register(records, {
      direction: 'OUTGOING',
      title: 'Pilot reply',
      ...pilot,
    });
    const plain = await register(records, { title: 'Ordinary request', ...pilot });
    const restricted = await register(records, {
      title: 'Restricted request',
      confidential: true,
      ...pilot,
    });

    await link(records, outgoing.id, plain.id).expect(201);
    await link(records, outgoing.id, restricted.id).expect(201);

    expect((await detail(records, outgoing.id)).referencedDocuments).toHaveLength(2);

    /*
     * One fewer entry, and nothing to say an entry was removed — no null, no placeholder, no count.
     * Two readers seeing different lengths for the same document is the intended behaviour of
     * decision 166, not a bug to reconcile.
     */
    const uncleared = await detail(staff, outgoing.id);
    expect(uncleared.referencedDocuments.map((entry) => entry.trackingNumber)).toEqual([
      plain.trackingNumber,
    ]);
    expect(JSON.stringify(uncleared.referencedDocuments)).not.toContain('Restricted request');
  });

  it('refuses the wrong direction on either side, and a document naming itself', async () => {
    const cookie = await asRecords();
    const outgoing = await register(cookie, { direction: 'OUTGOING', title: 'A letter' });
    const otherOutgoing = await register(cookie, {
      direction: 'OUTGOING',
      title: 'Another letter',
    });
    const incoming = await register(cookie, { title: 'A request' });

    const refusals: [string, string][] = [
      [outgoing.id, otherOutgoing.id], // an outgoing document is not a reference
      [incoming.id, outgoing.id], // an incoming document can never be the naming side
      [outgoing.id, outgoing.id], // and nothing may name itself
    ];
    for (const [naming, named] of refusals) {
      const refused = await link(cookie, naming, named).expect(422);
      expect(refused.body.error.code).toBe('REFERENCE_DIRECTION_INVALID');
    }

    // The direction rule is what makes cycles unrepresentable, so the relation stayed empty.
    expect((await detail(cookie, outgoing.id)).referencedDocuments).toEqual([]);
    expect((await detail(cookie, incoming.id)).replyDocuments).toEqual([]);
  });

  it('treats a repeated link as a quiet success: one row, one audit event, no conflict', async () => {
    const cookie = await asRecords();
    const outgoing = await register(cookie, { direction: 'OUTGOING', title: 'Reply letter' });
    const incoming = await register(cookie, { title: 'A request' });

    const audit = app.get(AuditWriter);
    if (!(audit instanceof InMemoryAuditWriter))
      throw new Error('expected the in-memory audit writer to be wired in');

    await link(cookie, outgoing.id, incoming.id).expect(201);
    // Not a 409: the unique pair makes the write idempotent, so a double submit is a success
    // (decision 179) — a UI looping over several ids must not have to track which it already sent.
    const repeated = (await link(cookie, outgoing.id, incoming.id).expect(201)).body.data as Detail;

    expect(repeated.referencedDocuments).toHaveLength(1);
    expect(
      audit.entries.filter((entry) => entry.action === 'document.reference-linked'),
    ).toHaveLength(1);
  });

  it('freezes the reference set once the outgoing document is released', async () => {
    const cookie = await asRecords();
    const outgoing = await register(cookie, { direction: 'OUTGOING', title: 'Sent letter' });
    const incoming = await register(cookie, { title: 'A request' });
    await link(cookie, outgoing.id, incoming.id).expect(201);

    /*
     * The status is forced through the repository rather than driven through the whole outgoing
     * workflow (initial, signature, prepare-release, release), which would say nothing extra about
     * this rule: what is under test is that the *existing* released/archived guard covers linking,
     * and the cheapest honest way to reach that state is to put the row in it.
     */
    const repository = app.get(DocumentsRepository);
    if (!(repository instanceof InMemoryDocumentsRepository))
      throw new Error('expected the in-memory documents repository to be wired in');
    await repository.updateForAction(outgoing.id, 1, { status: 'RELEASED' });

    const refused = await link(cookie, outgoing.id, incoming.id).expect(409);
    expect(refused.body.error.code).toBe('DOCUMENT_NOT_EDITABLE');
    // Immutable, not merely append-only: what a letter answered is fixed when the letter goes out
    // (decision 178), so unlinking is refused by the same rule.
    const refusedUnlink = await unlink(cookie, outgoing.id, incoming.id).expect(409);
    expect(refusedUnlink.body.error.code).toBe('DOCUMENT_NOT_EDITABLE');
  });

  it('refuses a malformed target id rather than letting it reach the database', async () => {
    const cookie = await asRecords();
    const outgoing = await register(cookie, { direction: 'OUTGOING', title: 'Reply letter' });

    const refused = await unlink(cookie, outgoing.id, 'not-a-uuid').expect(400);
    expect(refused.body.error.code).toBe('VALIDATION_FAILED');
  });
});
