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
import { CSRF_COOKIE, CSRF_HEADER } from '../src/modules/auth/session.service.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { MailRepository } from '../src/modules/mail/mail.repository.js';
import { DEFAULT_MAIL_BODY, MailService } from '../src/modules/mail/mail.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryDocumentsRepository } from './in-memory-documents.repository.js';
import { InMemoryFileVersionsRepository } from './in-memory-file-versions.repository.js';
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

/** The session cookie and the CSRF header the web `api` helper echoes from `dts_csrf`. */
const withCsrf = (cookie: string[]): Record<string, string | string[]> => {
  const pair = cookie.find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));
  if (pair === undefined) throw new Error('Login did not set a CSRF cookie');
  return { Cookie: cookie, [CSRF_HEADER]: pair.split(';')[0]!.slice(CSRF_COOKIE.length + 1) };
};

/** `smtpHost` set to this hands `SMTP_HOST` to the real `ConfigService` lookup. */
const FROM_CONFIG = Symbol('from config');

describe('REST release mail', () => {
  let app: INestApplication;
  let smtpHost: string | undefined | typeof FROM_CONFIG;

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
      key === 'SMTP_HOST' && smtpHost !== FROM_CONFIG
        ? smtpHost
        : original(key)) as ConfigService['get']);
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
  const sign = async (
    documentId: string,
    originalName = 'signed-letter.pdf',
    mediaType = 'application/pdf',
  ): Promise<string> => {
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
      mediaType,
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

  /** Moves a document straight to `status`, as the workflow would have. */
  const setStatus = async (documentId: string, status: string): Promise<void> => {
    const row = (await documentsRepo().findById(documentId))!;
    await documentsRepo().updateForAction(documentId, row.version, {
      status: status as typeof row.status,
    });
  };

  /** An outgoing document in the pilot section, signed, drafted and For release. */
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
    await setStatus(outgoing.id, 'FOR_RELEASE');
    return { documentId: outgoing.id, draft };
  };

  const base = (documentId: string) => `/api/v1/documents/${documentId}/mail`;
  const list = async (cookie: string[], documentId: string): Promise<MailMessage[]> =>
    (await request(server()).get(base(documentId)).set('Cookie', cookie).expect(200)).body
      .data as MailMessage[];
  /** Send names the revision the releaser reviewed: the one the message was last read with. */
  const send = (
    cookie: string[],
    documentId: string,
    message: Pick<MailMessage, 'id' | 'revision'>,
  ) =>
    request(server())
      .post(`${base(documentId)}/${message.id}/send`)
      .set(withCsrf(cookie))
      .send({ revision: message.revision });
  const patch = (cookie: string[], documentId: string, mailId: string, body: object) =>
    request(server())
      .patch(`${base(documentId)}/${mailId}`)
      .set(withCsrf(cookie))
      .send(body);
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

  it('drafts nothing when the signed file is not a PDF', async () => {
    const records = await asRecords();
    const outgoing = await register(records, {
      direction: 'OUTGOING',
      title: 'Signed as Word',
      recipients: [{ name: 'Agency', emails: ['clerk@agency.gov'] }],
    });
    await sign(
      outgoing.id,
      'signed.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );

    expect(await mail().createDraft(outgoing.id, RECORDS_ID, tx)).toBeNull();
    expect(await list(records, outgoing.id)).toEqual([]);
    expect(audit().entries.some((entry) => entry.action === 'mail.drafted')).toBe(false);
  });

  it('refuses to send without a To address', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records, { recipients: [] });
    expect(draft.to).toEqual([]);

    const refused = await send(records, documentId, draft).expect(422);
    expect(refused.body.error.code).toBe('MAIL_NO_RECIPIENTS');
    expect(mailSendEvents()).toHaveLength(0);
  });

  it('refuses to send while SMTP is not configured', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    smtpHost = undefined;

    const refused = await send(records, documentId, draft).expect(422);
    expect(refused.body.error.code).toBe('MAIL_NOT_CONFIGURED');
    expect((await list(records, documentId))[0]?.status).toBe('DRAFT');
  });

  it('treats an empty SMTP_HOST read through the ConfigModule as not configured', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    // `SMTP_HOST=` in the environment: validation maps it to undefined, but ConfigService.get
    // falls through to process.env and returns ''.
    smtpHost = FROM_CONFIG;
    const previous = process.env.SMTP_HOST;
    process.env.SMTP_HOST = '';
    try {
      expect(app.get(ConfigService).get('SMTP_HOST')).toBe('');
      const refused = await send(records, documentId, draft).expect(422);
      expect(refused.body.error.code).toBe('MAIL_NOT_CONFIGURED');
      expect(mailSendEvents()).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.SMTP_HOST;
      else process.env.SMTP_HOST = previous;
    }
  });

  it('sends a draft only while the document is For release', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await setStatus(documentId, 'RELEASED');

    const refused = await send(records, documentId, draft).expect(409);
    expect(refused.body.error.code).toBe('MAIL_DOCUMENT_NOT_FOR_RELEASE');
    expect(mailSendEvents()).toHaveLength(0);
    expect((await list(records, documentId))[0]?.status).toBe('DRAFT');
  });

  it('queues a draft with one outbox event, and a second send adds none', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);

    const queued = (await send(records, documentId, draft).expect(201)).body.data as MailMessage;
    expect(queued).toMatchObject({ id: draft.id, status: 'QUEUED' });
    expect(mailSendEvents()).toEqual([
      expect.objectContaining({
        idempotencyKey: `mail.send:${draft.id}`,
        payload: { mailId: draft.id, documentId },
      }),
    ]);

    const repeated = (await send(records, documentId, draft).expect(201)).body.data as MailMessage;
    expect(repeated.status).toBe('QUEUED');
    expect(mailSendEvents()).toHaveLength(1);
  });

  it('reads through the caller’s transaction, so a signature written inside it is seen', async () => {
    const records = await asRecords();
    const outgoing = await register(records, {
      direction: 'OUTGOING',
      title: 'Signed in the same transaction',
      recipients: [{ name: 'Agency', emails: ['clerk@agency.gov'] }],
    });
    const versionId = await sign(outgoing.id);
    /*
     * The in-memory repository ignores executors, so visibility is emulated: the signature is
     * answered only when the read is made on the transaction handle `createDraft` was given, and
     * the pool (no executor) sees none — which is what Postgres does for an uncommitted row.
     */
    const repository = documentsRepo();
    const signatures = await repository.listSignatures(outgoing.id);
    const insideOnly = (executor?: DatabaseExecutor) =>
      Promise.resolve(executor === tx ? signatures : []);
    vi.spyOn(repository, 'listSignatures').mockImplementation(
      (_id: string, executor?: DatabaseExecutor) => insideOnly(executor),
    );
    const findById = vi.spyOn(repository, 'findById');
    const requesters = vi.spyOn(repository, 'listLinkedRequesterEmails');

    const draft = await mail().createDraft(outgoing.id, RECORDS_ID, tx);

    expect(draft).toMatchObject({ documentId: outgoing.id, status: 'DRAFT' });
    expect(draft?.attachmentName).toBe('signed-letter.pdf');
    expect(versionId).toBeDefined();
    expect(findById).toHaveBeenCalledWith(outgoing.id, tx);
    expect(requesters).toHaveBeenCalledWith(outgoing.id, tx);
  });

  it('stores one address per field when a PATCH repeats one in another case', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);

    const updated = (
      await request(server())
        .patch(`${base(documentId)}/${draft.id}`)
        .set(withCsrf(records))
        .send({
          to: ['A@agency.gov', 'a@agency.gov', 'b@agency.gov'],
          cc: ['C@agency.gov', 'c@AGENCY.gov'],
          bcc: ['d@agency.gov', 'D@agency.gov'],
          subject: 'Subject',
          body: 'Body',
        })
        .expect(200)
    ).body.data as MailMessage;

    expect(updated).toMatchObject({
      to: ['a@agency.gov', 'b@agency.gov'],
      cc: ['c@agency.gov'],
      bcc: ['d@agency.gov'],
    });
    expect((await list(records, documentId))[0]).toMatchObject({
      to: ['a@agency.gov', 'b@agency.gov'],
      cc: ['c@agency.gov'],
      bcc: ['d@agency.gov'],
    });
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
        .set(withCsrf(records))
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

    await send(records, documentId, updated).expect(201);
    const refused = await request(server())
      .patch(`${base(documentId)}/${draft.id}`)
      .set(withCsrf(records))
      .send(edit)
      .expect(409);
    expect(refused.body.error.code).toBe('MAIL_NOT_DRAFT');
  });

  it('answers each message with a revision of its contents, changed only by an edit', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    expect(draft.revision).toMatch(/^[0-9a-f]{32}$/);
    expect((await list(records, documentId))[0]?.revision).toBe(draft.revision);

    const same = {
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
    };
    const unchanged = (await patch(records, documentId, draft.id, same).expect(200)).body
      .data as MailMessage;
    expect(unchanged.revision).toBe(draft.revision);

    const edited = (
      await patch(records, documentId, draft.id, { ...same, subject: 'Edited' }).expect(200)
    ).body.data as MailMessage;
    expect(edited.revision).not.toBe(draft.revision);
    expect((await list(records, documentId))[0]?.revision).toBe(edited.revision);
  });

  it('requires the revision to send', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);

    await request(server())
      .post(`${base(documentId)}/${draft.id}/send`)
      .set(withCsrf(records))
      .expect(400);
    expect(mailSendEvents()).toHaveLength(0);
  });

  it('refuses a send whose revision another save replaced: A saves, B saves, A sends', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    const content = { to: draft.to, cc: [], bcc: [], body: draft.body };

    const saveA = (
      await patch(records, documentId, draft.id, { ...content, subject: 'A' }).expect(200)
    ).body.data as MailMessage;
    await patch(records, documentId, draft.id, { ...content, subject: 'B' }).expect(200);

    const refused = await send(records, documentId, saveA).expect(409);
    expect(errorOf(refused)).toMatchObject({
      code: 'MAIL_CHANGED',
      message: 'This message was changed since you opened it; review it again',
    });
    expect(mailSendEvents()).toHaveLength(0);
    expect((await list(records, documentId))[0]).toMatchObject({ status: 'DRAFT', subject: 'B' });
  });

  it('refuses a send when the draft is edited between the check and the queue', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    const repository = mailRepo();
    const markQueued = repository.markQueued.bind(repository);
    vi.spyOn(repository, 'markQueued').mockImplementation(async (...args) => {
      // Another releaser's save lands after the revision check, before the conditional update.
      await repository.updateDraft(draft.id, {
        toAddresses: draft.to,
        ccAddresses: [],
        bccAddresses: [],
        subject: 'Changed underneath',
        body: draft.body,
      });
      return markQueued(...args);
    });

    const refused = await send(records, documentId, draft).expect(409);
    expect(refused.body.error.code).toBe('MAIL_CHANGED');
    expect(mailSendEvents()).toHaveLength(0);
    expect((await list(records, documentId))[0]?.status).toBe('DRAFT');
  });

  it('locks a skipped draft: it can be neither edited nor sent', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await request(server())
      .post(`${base(documentId)}/skip`)
      .set(withCsrf(records))
      .send({ remarks: 'Hand-delivered' })
      .expect(204);

    const edit = { to: draft.to, cc: [], bcc: [], subject: 'Stale dialog', body: draft.body };
    const refusedEdit = await patch(records, documentId, draft.id, edit).expect(409);
    expect(errorOf(refusedEdit)).toMatchObject({ code: 'MAIL_SKIPPED' });
    const refusedSend = await send(records, documentId, draft).expect(409);
    expect(errorOf(refusedSend)).toMatchObject({ code: 'MAIL_SKIPPED' });

    expect(mailSendEvents()).toHaveLength(0);
    expect((await list(records, documentId))[0]).toMatchObject({
      status: 'DRAFT',
      subject: draft.subject,
    });
    // The repository refuses too, so a skip that lands between the service's read and its
    // write cannot be overtaken.
    expect(
      await mailRepo().updateDraft(draft.id, {
        toAddresses: draft.to,
        ccAddresses: [],
        bccAddresses: [],
        subject: 'Race',
        body: draft.body,
      }),
    ).toBeNull();
    const row = (await mailRepo().findForDocument(documentId, draft.id))!;
    expect(await mailRepo().markQueued(draft.id, RECORDS_ID, row.updatedAt)).toBeNull();
  });

  it('still resends a skipped message that was later delivered', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await send(records, documentId, draft).expect(201);
    await request(server())
      .post(`${base(documentId)}/skip`)
      .set(withCsrf(records))
      .send({ remarks: 'Relay slow; hand-delivered' })
      .expect(204);
    mailRepo().setStatusForTest(draft.id, 'SENT');

    await request(server())
      .post(`${base(documentId)}/${draft.id}/resend`)
      .set(withCsrf(records))
      .expect(201);
  });

  /** Every mail route, with a body its validation pipe accepts so the service is reached. */
  const ROUTES: {
    name: string;
    call: (documentId: string, mailId: string) => request.Test;
  }[] = [
    { name: 'GET list', call: (id) => request(server()).get(base(id)) },
    {
      name: 'PATCH draft',
      call: (id, mailId) =>
        request(server())
          .patch(`${base(id)}/${mailId}`)
          .send({ to: ['clerk@agency.gov'], cc: [], bcc: [], subject: 'S', body: 'B' }),
    },
    {
      name: 'POST send',
      call: (id, mailId) =>
        request(server())
          .post(`${base(id)}/${mailId}/send`)
          .send({ revision: 'any' }),
    },
    {
      name: 'POST resend',
      call: (id, mailId) => request(server()).post(`${base(id)}/${mailId}/resend`),
    },
    {
      name: 'POST skip',
      call: (id) =>
        request(server())
          .post(`${base(id)}/skip`)
          .send({ remarks: 'Hand-delivered' }),
    },
  ];

  it.each(ROUTES.filter((route) => !route.name.startsWith('GET')))(
    '$name refuses a request without the CSRF header with 403 and changes nothing',
    async ({ call }) => {
      const records = await asRecords();
      const { documentId, draft } = await drafted(records);

      const refused = await call(documentId, draft.id).set('Cookie', records).expect(403);
      expect(errorOf(refused)).toMatchObject({ message: 'CSRF token missing or invalid' });
      const forged = { ...withCsrf(records), [CSRF_HEADER]: 'forged' };
      await call(documentId, draft.id).set(forged).expect(403);

      expect(mailSendEvents()).toHaveLength(0);
      expect((await list(records, documentId))[0]).toMatchObject({
        status: 'DRAFT',
        subject: draft.subject,
        skippedAt: null,
      });
    },
  );

  it('reads the list without the CSRF header, and accepts a mutation that echoes it', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);

    await request(server()).get(base(documentId)).set('Cookie', records).expect(200);
    await send(records, documentId, draft).expect(201);
  });

  it.each(ROUTES)('$name refuses a reader without DOCUMENT_RELEASE with 403', async ({ call }) => {
    const records = await asRecords();
    const staff = await asStaff();
    // Readable by the staff member (their own section), but they cannot release.
    const { documentId, draft } = await drafted(records);

    await call(documentId, draft.id).set(withCsrf(staff)).expect(403);
    expect(mailSendEvents()).toHaveLength(0);
    expect(await mail().releaseState(documentId)).toEqual({
      exists: true,
      sent: false,
      skipped: false,
    });
  });

  it.each(ROUTES)(
    '$name answers an unreadable confidential document exactly as a missing one',
    async ({ call }) => {
      const records = await asRecords();
      const staff = await asStaff();
      const { documentId, draft } = await drafted(records, { confidential: true });

      const unreadable = await call(documentId, draft.id).set(withCsrf(staff));
      const absent = await call(randomUUID(), randomUUID()).set(withCsrf(staff));
      expect(unreadable.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(errorOf(unreadable)).toEqual(errorOf(absent));
      expect(errorOf(unreadable)).toMatchObject({ message: 'Document not found' });
    },
  );

  it('resends a sent message as a new queued row and leaves the original untouched', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await send(records, documentId, draft).expect(201);
    mailRepo().setStatusForTest(draft.id, 'SENT');
    const [original] = await list(records, documentId);

    // Resend is not tied to For release: a lost mail may need sending again after the release.
    await setStatus(documentId, 'RELEASED');

    const resent = (
      await request(server())
        .post(`${base(documentId)}/${draft.id}/resend`)
        .set(withCsrf(records))
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
      .set(withCsrf(records))
      .expect(409);
    expect(refused.body.error.code).toBe('MAIL_NOT_RESENDABLE');
  });

  const skip = (cookie: string[], documentId: string, remarks: string) =>
    request(server())
      .post(`${base(documentId)}/skip`)
      .set(withCsrf(cookie))
      .send({ remarks });
  const skippedAudit = () => audit().entries.filter((entry) => entry.action === 'mail.skipped');

  it('skips the draft with a remark, audited by length only', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    expect((await mail().releaseState(documentId)).skipped).toBe(false);

    await skip(records, documentId, 'Hand-delivered').expect(204);

    expect((await mail().releaseState(documentId)).skipped).toBe(true);
    expect((await list(records, documentId))[0]?.skippedAt).not.toBeNull();
    expect(skippedAudit().map((entry) => entry.summary)).toEqual([
      { mailId: draft.id, remarksLength: 14 },
    ]);
  });

  it.each(['QUEUED', 'FAILED'] as const)(
    'skips the latest unsent message once it is %s',
    async (status) => {
      const records = await asRecords();
      const { documentId, draft } = await drafted(records);
      await send(records, documentId, draft).expect(201);
      if (status === 'FAILED') mailRepo().setStatusForTest(draft.id, 'FAILED');

      await skip(records, documentId, 'Relay down; hand-delivered').expect(204);

      const [row] = await list(records, documentId);
      expect(row).toMatchObject({ id: draft.id, status });
      expect(row?.skippedAt).not.toBeNull();
      expect((await mail().releaseState(documentId)).skipped).toBe(true);
    },
  );

  it('skips the newest of several unsent messages', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await send(records, documentId, draft).expect(201);
    mailRepo().setStatusForTest(draft.id, 'FAILED');
    const resent = (
      await request(server())
        .post(`${base(documentId)}/${draft.id}/resend`)
        .set(withCsrf(records))
        .expect(201)
    ).body.data as MailMessage;
    mailRepo().setStatusForTest(resent.id, 'FAILED');

    await skip(records, documentId, 'Relay down').expect(204);

    const rows = await list(records, documentId);
    expect(rows.find((row) => row.id === resent.id)?.skippedAt).not.toBeNull();
    expect(rows.find((row) => row.id === draft.id)?.skippedAt).toBeNull();
  });

  it('refuses to skip once a message is sent', async () => {
    const records = await asRecords();
    const { documentId, draft } = await drafted(records);
    await send(records, documentId, draft).expect(201);
    mailRepo().setStatusForTest(draft.id, 'SENT');

    const refused = await skip(records, documentId, 'Too late').expect(409);
    expect(refused.body.error.code).toBe('MAIL_ALREADY_SENT');
    expect((await mail().releaseState(documentId)).skipped).toBe(false);
    expect(skippedAudit()).toHaveLength(0);
  });

  it('keeps the first remark and writes one audit row when skipped twice', async () => {
    const records = await asRecords();
    const { documentId } = await drafted(records);

    await skip(records, documentId, 'Hand-delivered').expect(204);
    const [first] = await mailRepo().listForDocument(documentId);
    await skip(records, documentId, 'A different reason').expect(204);

    const [after] = await mailRepo().listForDocument(documentId);
    expect(after?.skipRemarks).toBe('Hand-delivered');
    expect(after?.skippedAt).toEqual(first?.skippedAt);
    expect(skippedAudit()).toHaveLength(1);
  });

  it('refuses to skip when there is no draft', async () => {
    const records = await asRecords();
    const outgoing = await register(records, { direction: 'OUTGOING', title: 'No mail' });
    const refused = await request(server())
      .post(`${base(outgoing.id)}/skip`)
      .set(withCsrf(records))
      .send({ remarks: 'Nothing here' })
      .expect(422);
    expect(refused.body.error.code).toBe('MAIL_NOTHING_TO_SKIP');
  });

  describe('prepare-release and the emailed release guard', () => {
    const act = (cookie: string[], documentId: string, action: string, body: object) =>
      request(server())
        .post(`/api/v1/documents/${documentId}/actions/${action}`)
        .set('Cookie', cookie)
        .send(body);

    /**
     * An outgoing document staged at `SIGNED` with a clean, signed PDF as its current attachment,
     * custody accepted over HTTP. `signed: false` stages the status with no signature event, which
     * is the one case `createDraft` answers `null` for. Returns the version to act on next.
     */
    const signedOutgoing = async (
      cookie: string[],
      { signed = true }: { signed?: boolean } = {},
    ): Promise<{ id: string; version: number }> => {
      const outgoing = await register(cookie, {
        direction: 'OUTGOING',
        title: 'Reply letter',
        recipients: [{ name: 'Agency', emails: ['clerk@agency.gov'] }],
      });
      const repository = documentsRepo();
      let row = (await repository.findById(outgoing.id))!;
      if (signed) {
        const versionId = await sign(outgoing.id);
        await app.get(FileVersionsRepository).recordScanStatus(versionId, 'CLEAN');
        row = (await repository.setCurrentFileVersion(outgoing.id, versionId))!;
        row = (await repository.updateForAction(outgoing.id, row.version, {
          status: 'SIGNED',
          signedFileVersionId: versionId,
        }))!;
      } else {
        row = (await repository.updateForAction(outgoing.id, row.version, { status: 'SIGNED' }))!;
      }
      // Registration hands the document to its own unit; nothing moves until that is accepted.
      await act(cookie, outgoing.id, 'ACCEPT', { expectedVersion: row.version }).expect(201);
      return { id: outgoing.id, version: row.version };
    };

    const prepared = async (cookie: string[]): Promise<{ id: string; version: number }> => {
      const document = await signedOutgoing(cookie);
      const response = await act(cookie, document.id, 'PREPARE_RELEASE', {
        expectedVersion: document.version,
      }).expect(201);
      return { id: document.id, version: (response.body.data as { version: number }).version };
    };

    it('drafts exactly one message when the document is prepared for release', async () => {
      const records = await asRecords();
      const document = await signedOutgoing(records);

      // A stale version is refused before anything is written, the draft included.
      await act(records, document.id, 'PREPARE_RELEASE', {
        expectedVersion: document.version - 1,
      }).expect(409);
      expect(await mailRepo().listForDocument(document.id)).toEqual([]);

      await act(records, document.id, 'PREPARE_RELEASE', {
        expectedVersion: document.version,
      }).expect(201);
      // Repeating the action now finds the document already For release.
      await act(records, document.id, 'PREPARE_RELEASE', {
        expectedVersion: document.version,
      }).expect(409);

      const messages = await list(records, document.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        status: 'DRAFT',
        to: ['clerk@agency.gov'],
        attachmentName: 'signed-letter.pdf',
      });
      expect(audit().entries.filter((entry) => entry.action === 'mail.drafted')).toHaveLength(1);
    });

    it('prepares a document with no signed version for release and drafts nothing', async () => {
      const records = await asRecords();
      const document = await signedOutgoing(records, { signed: false });

      const response = await act(records, document.id, 'PREPARE_RELEASE', {
        expectedVersion: document.version,
      }).expect(201);

      expect((response.body.data as { status: string }).status).toBe('FOR_RELEASE');
      expect(await mailRepo().listForDocument(document.id)).toEqual([]);
    });

    it('drafts nothing when an incoming document moves', async () => {
      const records = await asRecords();
      const incoming = await register(records, { title: 'Request', email: 'citizen@mail.com' });
      const createDraft = vi.spyOn(mail(), 'createDraft');
      const row = (await documentsRepo().findById(incoming.id))!;
      await act(records, incoming.id, 'ACCEPT', { expectedVersion: row.version }).expect(201);
      await act(records, incoming.id, 'COMPLY', {
        expectedVersion: row.version,
        remarks: 'Answered.',
      }).expect(201);
      expect(createDraft).not.toHaveBeenCalled();
    });

    it('offers RELEASE before the mail is sent, and refuses an emailed release with a code', async () => {
      const records = await asRecords();
      const document = await prepared(records);

      const detail = await request(server())
        .get(`/api/v1/documents/${document.id}`)
        .set('Cookie', records)
        .expect(200);
      expect((detail.body.data as { allowedActions: string[] }).allowedActions).toContain(
        'RELEASE',
      );

      const refused = await act(records, document.id, 'RELEASE', {
        expectedVersion: document.version,
        releaseMethod: 'EMAILED',
      }).expect(422);
      expect(errorOf(refused)).toMatchObject({
        code: 'RELEASE_MAIL_REQUIRED',
        message: 'Emailed release requires the message to be sent or skipped',
      });
    });

    it('releases by Emailed once the message is sent', async () => {
      const records = await asRecords();
      const document = await prepared(records);
      const [draft] = await list(records, document.id);
      await send(records, document.id, draft!).expect(201);

      // Queued is not sent: the worker has not delivered it yet.
      await act(records, document.id, 'RELEASE', {
        expectedVersion: document.version,
        releaseMethod: 'EMAILED',
      }).expect(422);

      mailRepo().setStatusForTest(draft!.id, 'SENT');
      const released = await act(records, document.id, 'RELEASE', {
        expectedVersion: document.version,
        releaseMethod: 'EMAILED',
      }).expect(201);
      expect((released.body.data as { status: string }).status).toBe('RELEASED');
    });

    it('releases by Emailed once the message is skipped', async () => {
      const records = await asRecords();
      const document = await prepared(records);
      await request(server())
        .post(`${base(document.id)}/skip`)
        .set(withCsrf(records))
        .send({ remarks: 'Sent from the office mailbox' })
        .expect(204);

      const released = await act(records, document.id, 'RELEASE', {
        expectedVersion: document.version,
        releaseMethod: 'EMAILED',
      }).expect(201);
      expect((released.body.data as { status: string }).status).toBe('RELEASED');
    });

    it('releases by any other method without reading the mail', async () => {
      const records = await asRecords();
      const document = await prepared(records);
      const releaseState = vi.spyOn(mail(), 'releaseState');

      await act(records, document.id, 'RELEASE', {
        expectedVersion: document.version,
        releaseMethod: 'PICKED_UP',
      }).expect(201);
      expect(releaseState).not.toHaveBeenCalled();
    });

    it('reads no mail state for the detail payload or its allowed actions', async () => {
      const records = await asRecords();
      const document = await prepared(records);
      const releaseState = vi.spyOn(mail(), 'releaseState');

      await request(server())
        .get(`/api/v1/documents/${document.id}`)
        .set('Cookie', records)
        .expect(200);
      expect(releaseState).not.toHaveBeenCalled();
    });

    it('releases by Emailed a document that has no message at all', async () => {
      // A document already For release before release mail shipped: nothing was drafted.
      const records = await asRecords();
      const document = await signedOutgoing(records);
      await setStatus(document.id, 'FOR_RELEASE');
      const row = (await documentsRepo().findById(document.id))!;
      expect(await mailRepo().listForDocument(document.id)).toEqual([]);

      const released = await act(records, document.id, 'RELEASE', {
        expectedVersion: row.version,
        releaseMethod: 'EMAILED',
      }).expect(201);
      expect((released.body.data as { status: string }).status).toBe('RELEASED');
    });
  });

  it('reports whether a document has any, a sent and a skipped message in one read', async () => {
    const records = await asRecords();
    const outgoing = await register(records, { direction: 'OUTGOING', title: 'No mail yet' });
    expect(await mail().releaseState(outgoing.id)).toEqual({
      exists: false,
      sent: false,
      skipped: false,
    });
    const { documentId, draft } = await drafted(records);
    expect(await mail().releaseState(documentId)).toEqual({
      exists: true,
      sent: false,
      skipped: false,
    });
    mailRepo().setStatusForTest(draft.id, 'SENT');
    expect(await mail().releaseState(documentId)).toEqual({
      exists: true,
      sent: true,
      skipped: false,
    });
  });
});
