import 'reflect-metadata';
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
 * Outgoing documents: the sender is always the Head of the Bureau, and the addressees are a list
 * of recipients with optional emails. Autocomplete for both names is scoped like every other read.
 */
describe('REST outgoing sender and recipients', () => {
  let app: INestApplication;
  let documents: InMemoryDocumentsRepository;

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
    documents = app.get<InMemoryDocumentsRepository>(DocumentsRepository);
  });

  afterEach(async () => {
    await app.close();
  });

  const asRecords = async (): Promise<string[]> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: 'Records@1234!' })
      .expect(201);
    const cookie = response.headers['set-cookie'];
    return Array.isArray(cookie) ? cookie : [String(cookie)];
  };

  const create = (cookie: string[], body: Record<string, unknown>) =>
    request(server())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Subject',
        type: 'LETTER',
        priority: 'NORMAL',
        divisionId: 'division-records',
        sectionId: 'section-intake',
        ...body,
      });

  it("sends an outgoing document in the Head of the Bureau's name whatever the client says", async () => {
    documents.headOfBureau = 'Engr. Maria Santos, Regional Director';
    const cookie = await asRecords();

    const response = await create(cookie, {
      direction: 'OUTGOING',
      sender: 'Somebody Else',
      recipients: [{ name: 'DENR Region III', emails: ['records@denr.gov.ph'] }],
    }).expect(201);

    expect((response.body as { data: { sender: string } }).data.sender).toBe(
      'Engr. Maria Santos, Regional Director',
    );
  });

  it('keeps the recipients, in order, each with its optional emails', async () => {
    const cookie = await asRecords();

    const created = await create(cookie, {
      direction: 'OUTGOING',
      recipients: [
        { name: 'DENR Region III', emails: ['records@denr.gov.ph', 'ord@denr.gov.ph'] },
        { name: 'Provincial Governor' },
      ],
    }).expect(201);
    const { id } = (created.body as { data: { id: string } }).data;

    const detail = await request(server()).get(`/api/v1/documents/${id}`).set('Cookie', cookie);
    expect((detail.body as { data: { recipients: unknown } }).data.recipients).toEqual([
      { name: 'DENR Region III', emails: ['records@denr.gov.ph', 'ord@denr.gov.ph'] },
      { name: 'Provincial Governor', emails: [] },
    ]);
  });

  it("keeps an incoming document's own sender and ignores recipients on it", async () => {
    const cookie = await asRecords();

    const response = await create(cookie, {
      direction: 'INCOMING',
      sender: 'A Correspondent',
      recipients: [{ name: 'Not Applicable' }],
    }).expect(201);

    const data = (response.body as { data: { sender: string; recipients: unknown[] } }).data;
    expect(data.sender).toBe('A Correspondent');
    expect(data.recipients).toEqual([]);
  });

  it('refuses a recipient with an invalid email address', async () => {
    const cookie = await asRecords();

    await create(cookie, {
      direction: 'OUTGOING',
      recipients: [{ name: 'DENR Region III', emails: ['not-an-email'] }],
    }).expect(400);
  });

  it('suggests recipient and sender names already used, and nothing under two characters', async () => {
    const cookie = await asRecords();
    await create(cookie, {
      direction: 'OUTGOING',
      recipients: [{ name: 'DENR Region III' }, { name: 'Provincial Governor' }],
    }).expect(201);
    await create(cookie, { direction: 'INCOMING', sender: 'Mayor of Angeles' }).expect(201);

    const recipients = await request(server())
      .get('/api/v1/documents/suggestions?kind=recipient&q=denr')
      .set('Cookie', cookie)
      .expect(200);
    expect((recipients.body as { data: string[] }).data).toEqual(['DENR Region III']);

    const senders = await request(server())
      .get('/api/v1/documents/suggestions?kind=sender&q=mayor')
      .set('Cookie', cookie)
      .expect(200);
    expect((senders.body as { data: string[] }).data).toEqual(['Mayor of Angeles']);

    await request(server())
      .get('/api/v1/documents/suggestions?kind=recipient&q=d')
      .set('Cookie', cookie)
      .expect(400);
  });

  it('never suggests a name from a confidential document', async () => {
    const cookie = await asRecords();
    await create(cookie, {
      direction: 'OUTGOING',
      confidential: true,
      recipients: [{ name: 'Secret Addressee' }],
    }).expect(201);

    const response = await request(server())
      .get('/api/v1/documents/suggestions?kind=recipient&q=secret')
      .set('Cookie', cookie)
      .expect(200);
    expect((response.body as { data: string[] }).data).toEqual([]);
  });
});
