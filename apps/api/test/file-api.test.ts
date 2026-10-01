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
import { InMemoryStorageAdapter, StoragePort } from '../src/modules/files/storage.port.js';
import { fakeTransactionalDatabase } from './test-database.js';

const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

// Supertest types the response body as `any`. This recovers just the typed slice each
// assertion needs, keeping the single unavoidable cast in one place instead of scattering
// it across every call site.
const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

// Minimal buffers whose leading magic bytes are what `file-type` inspects. The PDF and PNG
// are genuinely detectable; the "spoof" buffer is plain text wearing a application/pdf label.
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const SPOOF = Buffer.from('this is definitely not a pdf, just plain text pretending to be one');

describe('REST /api/v1 document attachments', () => {
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
      .overrideProvider(StoragePort)
      .useClass(InMemoryStorageAdapter)
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

  const login = async (email: string, password: string): Promise<string[]> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return sessionCookie(response);
  };

  const createOutgoing = async (
    cookie: string[],
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; version: number }> => {
    const response = await request(server())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Outgoing memorandum',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'OUTGOING',
        divisionId: 'division-records',
        sectionId: 'section-intake',
        ...overrides,
      })
      .expect(201);
    return dataOf<{ id: string; version: number }>(response);
  };

  const uploadFile = (
    cookie: string[],
    documentId: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
    attachmentId?: string,
  ) => {
    let pending = request(server())
      .post(`/api/v1/documents/${documentId}/attachments`)
      .set('Cookie', cookie);
    if (attachmentId !== undefined) pending = pending.field('attachmentId', attachmentId);
    return pending.attach('file', buffer, { filename, contentType });
  };

  const act = (
    cookie: string[],
    documentId: string,
    action: string,
    body: Record<string, unknown>,
  ) =>
    request(server())
      .post(`/api/v1/documents/${documentId}/actions/${action}`)
      .set('Cookie', cookie)
      .send(body);

  it('quarantines a new upload and only serves it after a clean scan (fail-closed)', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const document = await createOutgoing(cookie);

    const uploaded = await uploadFile(
      cookie,
      document.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201);
    expect(uploaded.body.data).toMatchObject({
      versionNumber: 1,
      mediaType: 'application/pdf',
      scanStatus: 'PENDING',
      isCurrent: true,
      isSigned: false,
    });
    const versionId = dataOf<{ id: string }>(uploaded).id;

    // Download must be refused while the version is still pending scan.
    const blocked = await request(server())
      .get(`/api/v1/documents/${document.id}/attachments/${versionId}/download`)
      .set('Cookie', cookie)
      .expect(409);
    expect(blocked.body.error.code).toBe('FILE_NOT_CLEAN');

    await request(server())
      .post(`/api/v1/documents/${document.id}/attachments/${versionId}/scan`)
      .set('Cookie', cookie)
      .send({ status: 'CLEAN' })
      .expect(201);

    const download = await request(server())
      .get(`/api/v1/documents/${document.id}/attachments/${versionId}/download`)
      .set('Cookie', cookie)
      .responseType('blob')
      .expect(200);
    expect(download.headers['content-type']).toContain('application/pdf');
    expect(download.headers['content-disposition']).toContain('attachment');
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.isBuffer(download.body)).toBe(true);
    expect((download.body as Buffer).equals(PDF)).toBe(true);
  });

  it('releases an outgoing document only after its current attachment is clean and signed', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie); // version 1

    const uploaded = await uploadFile(
      cookie,
      created.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201); // document -> version 2
    const versionId = dataOf<{ id: string }>(uploaded).id;

    await request(server())
      .post(`/api/v1/documents/${created.id}/attachments/${versionId}/scan`)
      .set('Cookie', cookie)
      .send({ status: 'CLEAN' })
      .expect(201); // scan does not bump the document version

    await act(cookie, created.id, 'ACCEPT', { expectedVersion: 2 }).expect(201); // -> 3
    await act(cookie, created.id, 'SUBMIT_FOR_SIGNATURE', { expectedVersion: 3 }).expect(201); // -> 4
    const signed = await act(cookie, created.id, 'SIGN', { expectedVersion: 4 }).expect(201); // -> 5
    expect(signed.body.data.signedAttachmentVersionId).toBe(versionId);
    await act(cookie, created.id, 'PREPARE_RELEASE', { expectedVersion: 5 }).expect(201); // -> 6

    const released = await act(cookie, created.id, 'RELEASE', {
      expectedVersion: 6,
      releaseMethod: 'MAILED',
    }).expect(201);
    expect(released.body.data).toMatchObject({ status: 'RELEASED', releaseMethod: 'MAILED' });
  });

  it('blocks release when a newer unsigned version supersedes the signed one', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie); // version 1

    const first = await uploadFile(cookie, created.id, PDF, 'v1.pdf', 'application/pdf').expect(
      201,
    ); // -> 2
    const firstData = dataOf<{ id: string; attachmentId: string }>(first);
    const firstVersionId = firstData.id;
    const attachmentId = firstData.attachmentId;
    await request(server())
      .post(`/api/v1/documents/${created.id}/attachments/${firstVersionId}/scan`)
      .set('Cookie', cookie)
      .send({ status: 'CLEAN' })
      .expect(201);

    await act(cookie, created.id, 'ACCEPT', { expectedVersion: 2 }).expect(201); // -> 3
    await act(cookie, created.id, 'SUBMIT_FOR_SIGNATURE', { expectedVersion: 3 }).expect(201); // -> 4
    await act(cookie, created.id, 'SIGN', { expectedVersion: 4 }).expect(201); // -> 5, signs v1

    // A second version of the same attachment supersedes the signed one and resets clean-state.
    await uploadFile(cookie, created.id, PDF, 'v2.pdf', 'application/pdf', attachmentId).expect(
      201,
    ); // -> 6
    await act(cookie, created.id, 'PREPARE_RELEASE', { expectedVersion: 6 }).expect(201); // -> 7

    const blocked = await act(cookie, created.id, 'RELEASE', {
      expectedVersion: 7,
      releaseMethod: 'MAILED',
    }).expect(422);
    expect(blocked.body.error.code).toBe('RELEASE_BLOCKED');
  });

  it('rejects an empty upload', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const document = await createOutgoing(cookie);
    const rejected = await uploadFile(
      cookie,
      document.id,
      Buffer.alloc(0),
      'empty.pdf',
      'application/pdf',
    ).expect(400);
    expect(rejected.body.error.code).toBe('EMPTY_FILE');
  });

  it('rejects a file whose real bytes do not match an allowed media type', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const document = await createOutgoing(cookie);

    const rejected = await uploadFile(
      cookie,
      document.id,
      SPOOF,
      'evil.pdf',
      'application/pdf',
    ).expect(415);
    expect(rejected.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('hides attachments of documents the caller cannot read', async () => {
    const recordsCookie = await login('records@dts.local', 'Records@1234!');
    const document = await createOutgoing(recordsCookie, { divisionId: 'division-records' });
    const uploaded = await uploadFile(
      recordsCookie,
      document.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201);
    const versionId = dataOf<{ id: string }>(uploaded).id;

    const staffCookie = await login('staff@dts.local', 'Staff@12345!');
    await request(server())
      .get(`/api/v1/documents/${document.id}/attachments`)
      .set('Cookie', staffCookie)
      .expect(404);
    await request(server())
      .get(`/api/v1/documents/${document.id}/attachments/${versionId}/download`)
      .set('Cookie', staffCookie)
      .expect(404);
  });

  it('does not expose a version through a sibling document path (IDOR)', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const documentA = await createOutgoing(cookie);
    const documentB = await createOutgoing(cookie);
    const uploaded = await uploadFile(
      cookie,
      documentA.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201);
    const versionId = dataOf<{ id: string }>(uploaded).id;

    // Even the owner cannot fetch document A's version through document B's route.
    await request(server())
      .get(`/api/v1/documents/${documentB.id}/attachments/${versionId}/download`)
      .set('Cookie', cookie)
      .expect(404);
  });

  it('serves a clean version inline for preview, locked down and separately audited', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const document = await createOutgoing(cookie);
    const uploaded = await uploadFile(
      cookie,
      document.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201);
    const versionId = dataOf<{ id: string }>(uploaded).id;

    // Same fail-closed rule as the download: a pending scan cannot be read around by asking for
    // the preview instead.
    const blocked = await request(server())
      .get(`/api/v1/documents/${document.id}/attachments/${versionId}/content`)
      .set('Cookie', cookie)
      .expect(409);
    expect(blocked.body.error.code).toBe('FILE_NOT_CLEAN');

    await request(server())
      .post(`/api/v1/documents/${document.id}/attachments/${versionId}/scan`)
      .set('Cookie', cookie)
      .send({ status: 'CLEAN' })
      .expect(201);

    const preview = await request(server())
      .get(`/api/v1/documents/${document.id}/attachments/${versionId}/content`)
      .set('Cookie', cookie)
      .responseType('blob')
      .expect(200);
    expect(preview.headers['content-type']).toContain('application/pdf');
    expect(preview.headers['content-disposition']).toContain('inline');
    expect(preview.headers['content-disposition']).toContain('plan.pdf');
    expect(preview.headers['x-content-type-options']).toBe('nosniff');
    expect(preview.headers['cache-control']).toBe('private, no-store');
    // The bytes may render themselves and do nothing else.
    expect(preview.headers['content-security-policy']).toContain("default-src 'none'");
    expect(preview.headers['content-security-policy']).toContain('sandbox');
    expect((preview.body as Buffer).equals(PDF)).toBe(true);

    const audit = app.get(AuditWriter);
    if (!(audit instanceof InMemoryAuditWriter))
      throw new Error('expected the in-memory audit writer to be wired in');
    const previewed = audit.entries.filter((entry) => entry.action === 'attachment.previewed');
    expect(previewed).toHaveLength(1);
    expect(previewed[0]?.summary).toMatchObject({ versionId, mediaType: 'application/pdf' });
    // A preview is not a download: the two must stay distinguishable in the trail.
    expect(audit.entries.filter((entry) => entry.action === 'attachment.downloaded')).toHaveLength(
      0,
    );
  });

  it('refuses a preview of a version outside the scope the document read allows', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const document = await createOutgoing(cookie, { confidential: true });
    const uploaded = await uploadFile(
      cookie,
      document.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201);
    const versionId = dataOf<{ id: string }>(uploaded).id;
    await request(server())
      .post(`/api/v1/documents/${document.id}/attachments/${versionId}/scan`)
      .set('Cookie', cookie)
      .send({ status: 'CLEAN' })
      .expect(201);

    const staffCookie = await login('staff@dts.local', 'Staff@12345!');
    await request(server())
      .get(`/api/v1/documents/${document.id}/attachments/${versionId}/content`)
      .set('Cookie', staffCookie)
      .expect(404);
  });

  it('forbids a viewer from uploading attachments', async () => {
    const staffCookie = await login('staff@dts.local', 'Staff@12345!');
    const document = await createOutgoing(staffCookie, {
      divisionId: 'division-pilot',
      sectionId: 'section-pilot',
    });

    const viewerCookie = await login('viewer@dts.local', 'Viewer@1234!');
    await uploadFile(viewerCookie, document.id, PDF, 'plan.pdf', 'application/pdf').expect(403);
  });
});
