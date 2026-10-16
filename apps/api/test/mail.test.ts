import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import type { MailMessage } from '@dts/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { DatabaseExecutor } from '../src/database/executor.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';
import { OutboxWriter } from '../src/modules/audit/outbox.writer.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { MailRepository } from '../src/modules/mail/mail.repository.js';
import { MailSender } from '../src/modules/mail/mail-sender.js';
import { DEFAULT_MAIL_BODY, MailService } from '../src/modules/mail/mail.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryDocumentsRepository } from './in-memory-documents.repository.js';
import { InMemoryFileVersionsRepository } from './in-memory-file-versions.repository.js';
import { InMemoryMailSender } from './in-memory-mail-sender.js';
import { InMemoryMailRepository } from './in-memory-mail.repository.js';
import { InMemoryOutboxWriter } from './in-memory-outbox.writer.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';
import { fakeTransactionalDatabase } from './test-database.js';

/**
 * Release mail over HTTP: the draft written when an outgoing document is prepared for release,
 * and the compose, send, resend and skip routes under `documents/:id/mail`.
 */

const RECORDS_ID = '00000000-0000-4000-8000-000000000001';
const PILOT = { divisionId: 'division-pilot', sectionId: 'section-pilot' };

const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

// The error envelope minus its per-request correlation id (see reference-documents.test.ts).
const errorOf = (response: { body: unknown }): unknown => {
  const error = { ...(response.body as { error: Record<string, unknown> }).error };
  delete error.correlationId;
  return error;
};

describe('REST release mail', () => {
  let app: INestApplication;
  let smtpHost: string | undefined;

  const server = (): Server => app.getHttpServer() as Server;
  const tx = {} as DatabaseExecutor;

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
      .overrideProvider(MailRepository)
      .useClass(InMemoryMailRepository)
      .overrideProvider(MailSender)
      .useClass(InMemoryMailSender)
      .overrideProvider(DATABASE)
      .useValue(fakeTransactionalDatabase)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    // SMTP is configured unless a case says otherwise; the env file the suite boots with has none.
    smtpHost = 'smtp.test';
    const config = app.get(ConfigService);
    if (!(config instanceof ConfigService)) throw new Error('expected the ConfigService');
    // Captured before the spy replaces `get`, so the passthrough cannot recurse into it.
    const original = config.get.bind(config);
    vi.spyOn(config, 'get').mockImplementation(((key: string): unknown =>
      key === 'SMTP_HOST' ? smtpHost : original(key)) as ConfigService['get']);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  const login = async (email: string, password: string): Promise<string[]> =>
    sessionCookie(
      await request(server()).post('/api/v1/auth/login').send({ email, password }).expect(201),
    );
  const asRecords = () => login('records@dts.local', 'Records@1234!');
  const asStaff = () => login('staff@dts.local', 'Staff@12345!');

  const documentsRepo = (): InMemoryDocumentsRepository => {
    const repository = app.get(DocumentsRepository);
    if (!(repository instanceof InMemoryDocumentsRepository))
      throw new Error('expected the in-memory documents repository');
    return repository;
  };
  const mailRepo = (): InMemoryMailRepository => {
    const repository = app.get(MailRepository);
    if (!(repository instanceof InMemoryMailRepository))
      throw new Error('expected the in-memory mail repository');
    return repository;
  };
  const audit = (): InMemoryAuditWriter => app.get(AuditWriter);
  const outbox = (): InMemoryOutboxWriter => app.get(OutboxWriter);
  const mail = (): MailService => app.get(MailService);

  const register = async (
    cookie: string[],
    overrides: Record<string, unknown>,
  ): Promise<{ id: string; referenceNumber: string | null; title: string }> => {
    const created = await request(server())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Subject',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'A Correspondent',
        divisionId: 'division-records',
        sectionId: 'section-intake',
        ...overrides,
      })
      .expect(201);
    return created.body.data as { id: string; referenceNumber: string | null; title: string };
  };

  /** Records a signature on a fresh PDF version, as `SIGN` would. */
  const sign = async (documentId: string, originalName = 'signed-letter.pdf'): Promise<string> => {
    const files = app.get(FileVersionsRepository);
    const record = await files.createRecord({
      documentId,
      displayName: 'Letter',
      createdById: RECORDS_ID,
    });
    const versionId = randomUUID();
    await files.createVersion({
      id: versionId,
      fileRecordId: record.id,
      versionNumber: 1,
      objectKey: `documents/${documentId}/${versionId}`,
      originalName,
      mediaType: 'application/pdf',
      sizeBytes: 1024,
      checksumSha256: 'a'.repeat(64),
      uploaderId: RECORDS_ID,
    });
    await documentsRepo().insertSignatureEvent({
      documentId,
      fileVersionId: versionId,
      signerId: RECORDS_ID,
    });
    return versionId;
  };

  /** An outgoing document in the pilot section, signed and drafted. */
  const drafted = async (
    cookie: string[],
    overrides: Record<string, unknown> = {},
  ): Promise<{ documentId: string; draft: MailMessage }> => {
    const outgoing = await register(cookie, {
      direction: 'OUTGOING',
      title: 'Reply letter',
      recipients: [{ name: 'Agency', emails: ['clerk@agency.gov'] }],
      ...PILOT,
      ...overrides,
    });
    await sign(outgoing.id);
    const draft = await mail().createDraft(outgoing.id, RECORDS_ID, tx);
    if (draft === null) throw new Error('expected a draft');
    return { documentId: outgoing.id, draft };
  };

  const base = (documentId: string) => `/api/v1/documents/${documentId}/mail`;
  const list = async (cookie: string[], documentId: string): Promise<MailMessage[]> =>
    (await request(server()).get(base(documentId)).set('Cookie', cookie).expect(200)).body
      .data as MailMessage[];
  const send = (cookie: string[], documentId: string, mailId: string) =>
    request(server())
      .post(`${base(documentId)}/${mailId}/send`)
      .set('Cookie', cookie);
  const mailSendEvents = () => outbox().events.filter((event) => event.eventType === 'mail.send');

  it('drafts one message to the recipients and the linked requester, de-duplicated', async () => {
    const records = await asRecords();
    const outgoing = await register(records, {
      direction: 'OUTGOING',
      title: 'Reply letter',
      recipients: [
        { name: 'Agency', emails: ['Clerk@Agency.gov', 'head@agency.gov'] },
        { name: 'Other office', emails: ['clerk@agency.gov'] },
      ],
    });
    const request1 = await register(records, { title: 'Request', email: 'citizen@mail.com' });
    const request2 = await register(records, { title: 'Second request', email: 'HEAD@agency.gov' });
    const request3 = await register(records, { title: 'Walk-in request' });
    for (const incoming of [request1, request2, request3])
      await request(server())
        .post(`/api/v1/documents/${outgoing.id}/references`)
        .set('Cookie', records)
        .send({ incomingDocumentId: incoming.id })
        .expect(201);
    await sign(outgoing.id, 'reply-signed.pdf');

    const draft = await mail().createDraft(outgoing.id, RECORDS_ID, tx);

    expect(draft).toMatchObject({
      documentId: outgoing.id,
      to: ['clerk@agency.gov', 'head@agency.gov', 'citizen@mail.com'],
      cc: [],
      bcc: [],
      subject: `${outgoing.referenceNumber}: Reply letter`,
      body: DEFAULT_MAIL_BODY,
      attachmentName: 'reply-signed.pdf',
      status: 'DRAFT',
      skippedAt: null,
    });

    // Idempotent per document: the second call returns the same draft and writes nothing more.
    const again = await mail().createDraft(outgoing.id, RECORDS_ID, tx);
    expect(again?.id).toBe(draft?.id);
    expect(await list(records, outgoing.id)).toHaveLength(1);

    const drafts = audit().entries.filter((entry) => entry.action === 'mail.drafted');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.summary).toEqual({ recipients: 3 });
    // Counts only: no address leaks into the trail.
    expect(JSON.stringify(audit().entries)).not.toContain('@agency.gov');
  });

  it('drafts nothing when the document has no signed version', async () => {
    const records = await asRecords();
    const outgoing = await register(records, { direction: 'OUTGOING', title: 'Unsigned' });

    expect(await mail().createDraft(outgoing.id, RECORDS_ID, tx)).toBeNull();
    expect(await list(records, outgoing.id)).toEqual([]);
    expect(audit().entries.some((entry) => entry.action === 'mail.drafted')).toBe(false);
  });

  it('refuses to send without a To address', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records, { recipients: [] });
    expect(draft.to).toEqual([]);

    const refused = await send(records, documentId, draft.id).expect(422);
    expect(refused.body.error.code).toBe('MAIL_NO_RECIPIENTS');
    expect(mailSendEvents()).toHaveLength(0);
  });

  it('refuses to send while SMTP is not configured', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    smtpHost = undefined;

    const refused = await send(records, documentId, draft.id).expect(422);
    expect(refused.body.error.code).toBe('MAIL_NOT_CONFIGURED');
    expect((await list(records, documentId))[0]?.status).toBe('DRAFT');
  });

  it('queues a draft with one outbox event, and a second send adds none', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);

    const queued = (await send(records, documentId, draft.id).expect(201)).body.data as MailMessage;
    expect(queued).toMatchObject({ id: draft.id, status: 'QUEUED' });
    expect(mailSendEvents()).toEqual([
      expect.objectContaining({
        idempotencyKey: `mail.send:${draft.id}`,
        payload: { mailId: draft.id, documentId },
      }),
    ]);

    const repeated = (await send(records, documentId, draft.id).expect(201)).body
      .data as MailMessage;
    expect(repeated.status).toBe('QUEUED');
    expect(mailSendEvents()).toHaveLength(1);
  });

  it('edits a draft and refuses to edit a queued message', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    const edit = {
      to: ['Clerk@Agency.gov'],
      cc: ['records@office.gov'],
      bcc: [],
      subject: 'Edited subject',
      body: 'Edited body',
    };

    const updated = (
      await request(server())
        .patch(`${base(documentId)}/${draft.id}`)
        .set('Cookie', records)
        .send(edit)
        .expect(200)
    ).body.data as MailMessage;
    expect(updated).toMatchObject({
      to: ['clerk@agency.gov'],
      cc: ['records@office.gov'],
      subject: 'Edited subject',
      body: 'Edited body',
      status: 'DRAFT',
    });

    await send(records, documentId, draft.id).expect(201);
    const refused = await request(server())
      .patch(`${base(documentId)}/${draft.id}`)
      .set('Cookie', records)
      .send(edit)
      .expect(409);
    expect(refused.body.error.code).toBe('MAIL_NOT_DRAFT');
  });

  it('refuses a reader without DOCUMENT_RELEASE with 403', async () => {
    const records = await asRecords();
    const staff = await asStaff();
    // Readable by the staff member (their own section), but they cannot release.
    const { documentId } = await drafted(records);

    await request(server()).get(base(documentId)).set('Cookie', staff).expect(403);
  });

  it('answers an unreadable confidential document exactly as a missing one', async () => {
    const records = await asRecords();
    const staff = await asStaff();
    const { documentId } = await drafted(records, { confidential: true });

    const unreadable = await request(server()).get(base(documentId)).set('Cookie', staff);
    const absent = await request(server()).get(base(randomUUID())).set('Cookie', staff);
    expect(unreadable.status).toBe(404);
    expect(absent.status).toBe(404);
    expect(errorOf(unreadable)).toEqual(errorOf(absent));
    expect(errorOf(unreadable)).toMatchObject({ message: 'Document not found' });
  });

  it('resends a sent message as a new queued row and leaves the original untouched', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await send(records, documentId, draft.id).expect(201);
    mailRepo().setStatusForTest(draft.id, 'SENT');
    const [original] = await list(records, documentId);

    const resent = (
      await request(server())
        .post(`${base(documentId)}/${draft.id}/resend`)
        .set('Cookie', records)
        .expect(201)
    ).body.data as MailMessage;

    expect(resent.id).not.toBe(draft.id);
    expect(resent).toMatchObject({
      status: 'QUEUED',
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      attachmentName: draft.attachmentName,
    });
    const after = await list(records, documentId);
    expect(after).toHaveLength(2);
    expect(after.find((row) => row.id === draft.id)).toEqual(original);
    expect(mailSendEvents().map((event) => event.idempotencyKey)).toEqual([
      `mail.send:${draft.id}`,
      `mail.send:${resent.id}`,
    ]);
    const resentAudit = audit().entries.filter((entry) => entry.action === 'mail.resent');
    expect(resentAudit).toHaveLength(1);
    expect(resentAudit[0]?.summary).toEqual({ recipients: 1, sourceMailId: draft.id });
  });

  it('refuses to resend a draft', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    const refused = await request(server())
      .post(`${base(documentId)}/${draft.id}/resend`)
      .set('Cookie', records)
      .expect(409);
    expect(refused.body.error.code).toBe('MAIL_NOT_RESENDABLE');
  });

  it('skips the draft with a remark, audited by length only', async () => {
    const records = await asRecords();
    const { documentId } = await drafted(records);
    expect(await mail().hasSkipped(documentId)).toBe(false);

    await request(server())
      .post(`${base(documentId)}/skip`)
      .set('Cookie', records)
      .send({ remarks: 'Hand-delivered' })
      .expect(204);

    expect(await mail().hasSkipped(documentId)).toBe(true);
    expect((await list(records, documentId))[0]?.skippedAt).not.toBeNull();
    const skipped = audit().entries.filter((entry) => entry.action === 'mail.skipped');
    expect(skipped.map((entry) => entry.summary)).toEqual([{ remarksLength: 14 }]);
  });

  it('refuses to skip when there is no draft', async () => {
    const records = await asRecords();
    const outgoing = await register(records, { direction: 'OUTGOING', title: 'No mail' });
    const refused = await request(server())
      .post(`${base(outgoing.id)}/skip`)
      .set('Cookie', records)
      .send({ remarks: 'Nothing here' })
      .expect(422);
    expect(refused.body.error.code).toBe('MAIL_NOTHING_TO_SKIP');
  });

  it('reports whether a document has a sent message', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    expect(await mail().hasSent(documentId)).toBe(false);
    mailRepo().setStatusForTest(draft.id, 'SENT');
    expect(await mail().hasSent(documentId)).toBe(true);
  });
});
