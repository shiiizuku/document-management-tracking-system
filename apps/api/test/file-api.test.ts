import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
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

/**
 * Minimal but genuine OOXML containers.
 *
 * Built rather than inlined as base64 because the single byte-level difference that matters here
 * is the ContentType string in `[Content_Types].xml`: that is what makes one of these a `.docx`
 * and the other a macro-enabled `.docm`, and it is what the sniffer reads. A fixture blob would
 * hide the thing under test.
 */
const ooxml = (contentType: string, dir: string): Buffer =>
  Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${dir}/document.xml" ContentType="${contentType}"/></Types>`,
      ),
      '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships/>'),
      [`${dir}/document.xml`]: strToU8('<?xml version="1.0"?><w:document/>'),
    }),
  );

const DOCX = ooxml(
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  'word',
);
const DOCM = ooxml('application/vnd.ms-word.document.macroEnabled.main+xml', 'word');
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

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

  /**
   * Records the scanner's verdict the way the worker does, through the repository. There is no
   * HTTP route for it: a verdict can only come from scanning the stored bytes.
   */
  const markScanned = async (
    versionId: string,
    status: 'CLEAN' | 'INFECTED' = 'CLEAN',
  ): Promise<void> => {
    await app.get(FileVersionsRepository).recordScanStatus(versionId, status);
  };

  const login = async (email: string, password: string): Promise<string[]> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return sessionCookie(response);
  };

  /*
   * Signing is the Director's act alone (ADR-0006): records staff lost `DOCUMENT_SIGN` when the
   * role landed. The outgoing suites below therefore drive the whole path as the records officer
   * and switch actors for the one step that is no longer theirs — which is what the privilege
   * reduction looks like from the outside.
   */
  const directorLogin = () => login('director@dts.local', 'Director@1234!');

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

    await markScanned(versionId);

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

    await markScanned(versionId); // scan does not bump the document version

    // Accepting custody stamps the route row and leaves the document untouched, so the version
    // does not move here — every expectedVersion below is one lower than before the revision.
    await act(cookie, created.id, 'ACCEPT', { expectedVersion: 2 }).expect(201); // stays 2
    await act(cookie, created.id, 'SUBMIT_FOR_SIGNATURE', { expectedVersion: 2 }).expect(201); // -> 3
    const signed = await act(await directorLogin(), created.id, 'SIGN', {
      expectedVersion: 3,
    }).expect(201); // -> 4
    expect(signed.body.data.signedAttachmentVersionId).toBe(versionId);
    await act(cookie, created.id, 'PREPARE_RELEASE', { expectedVersion: 4 }).expect(201); // -> 5

    /*
     * Which codes exist is a row, not a Zod enum, so an unknown or withdrawn method is a 400 from
     * the service rather than a schema rejection. This is the one cost of making the list
     * configurable, and it is worth asserting: the failure has to be refusal, not a release
     * recorded against nothing.
     */
    const unknown = await act(cookie, created.id, 'RELEASE', {
      expectedVersion: 5,
      releaseMethod: 'CARRIER_PIGEON',
    }).expect(400);
    expect(unknown.body.error.message).toContain('Unknown release method');

    // Mailed by Postal: two questions since migration 0013, and every carrier takes a tracking
    // reference (policy register P-15 as decided 2026-10-06).
    const released = await act(cookie, created.id, 'RELEASE', {
      expectedVersion: 5,
      releaseMethod: 'MAILED',
      releaseCarrier: 'POSTAL',
      trackingReference: 'RR123456789PH',
    }).expect(201);
    expect(released.body.data).toMatchObject({
      status: 'RELEASED',
      releaseMethod: {
        code: 'MAILED',
        label: 'Mailed',
        requiresCarrier: true,
        carrier: { code: 'POSTAL', label: 'Postal' },
        trackingReference: 'RR123456789PH',
      },
    });
  });

  /*
   * A mailed release recorded before carriers were asked for has no carrier, and migration 0013
   * will not invent one. Records staff fill it in, once: the correction completes a blank and
   * never rewrites an answer, and nobody without `DOCUMENT_RELEASE_CORRECT` may make it.
   */
  it('lets records staff fill in the carrier of an earlier mailed release, once', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie);
    app.get<InMemoryDocumentsRepository>(DocumentsRepository).seedReleaseWithoutCarrier(created.id);
    const correct = (session: string[], body: Record<string, unknown>) =>
      request(server())
        .post(`/api/v1/documents/${created.id}/release/carrier`)
        .set('Cookie', session)
        .send(body);

    await correct(await directorLogin(), { carrier: 'LBC' }).expect(403);
    const unknown = await correct(cookie, { carrier: 'CARRIER_PIGEON' }).expect(400);
    expect(unknown.body.error.message).toContain('Unknown carrier');

    // No tracking reference: the release was made without one, so the correction cannot demand it.
    const recorded = await correct(cookie, { carrier: 'LBC' }).expect(201);
    expect(recorded.body.data.releaseMethod).toMatchObject({
      code: 'MAILED',
      carrier: { code: 'LBC', label: 'LBC' },
      trackingReference: null,
    });

    const again = await correct(cookie, { carrier: 'JRS' }).expect(409);
    expect(again.body.error.code).toBe('RELEASE_CARRIER_RECORDED');
  });

  /*
   * The other half of ADR-0006, and the one worth a test of its own: the privilege *reduction*.
   * A records officer can still carry an outgoing draft right up to the signature line, which is
   * what makes the refusal meaningful — it is not a scope failure or a missing document, it is the
   * one act custody does not confer. Division heads are refused by the same table; they initial.
   */
  it('refuses signing to records staff, who may do everything up to it', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie); // version 1

    const uploaded = await uploadFile(
      cookie,
      created.id,
      PDF,
      'plan.pdf',
      'application/pdf',
    ).expect(201); // -> 2
    const versionId = dataOf<{ id: string }>(uploaded).id;
    await markScanned(versionId);

    await act(cookie, created.id, 'ACCEPT', { expectedVersion: 2 }).expect(201); // stays 2
    await act(cookie, created.id, 'SUBMIT_FOR_SIGNATURE', { expectedVersion: 2 }).expect(201); // -> 3

    await act(cookie, created.id, 'SIGN', { expectedVersion: 3 }).expect(403);

    // The refusal left the document where it was, so the Director can still take it from here.
    await act(await directorLogin(), created.id, 'SIGN', { expectedVersion: 3 }).expect(201);
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
    await markScanned(firstVersionId);

    await act(cookie, created.id, 'ACCEPT', { expectedVersion: 2 }).expect(201); // stays 2
    await act(cookie, created.id, 'SUBMIT_FOR_SIGNATURE', { expectedVersion: 2 }).expect(201); // -> 3
    await act(await directorLogin(), created.id, 'SIGN', { expectedVersion: 3 }).expect(201); // -> 4, signs v1

    // A second version of the same attachment supersedes the signed one and resets clean-state.
    await uploadFile(cookie, created.id, PDF, 'v2.pdf', 'application/pdf', attachmentId).expect(
      201,
    ); // -> 5
    await act(cookie, created.id, 'PREPARE_RELEASE', { expectedVersion: 5 }).expect(201); // -> 6

    const blocked = await act(cookie, created.id, 'RELEASE', {
      expectedVersion: 6,
      releaseMethod: 'EMAILED',
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

  /*
   * Policy register P-06: Office documents are storable. The two OOXML types are named
   * explicitly, which is what keeps their macro-enabled twins out without a second rule.
   */
  it('accepts a Word document', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie);

    const uploaded = await uploadFile(cookie, created.id, DOCX, 'draft.docx', DOCX_TYPE).expect(
      201,
    );
    expect(dataOf<{ mediaType: string }>(uploaded).mediaType).toBe(DOCX_TYPE);
  });

  it('refuses a macro-enabled Word document, and says what to do instead', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie);

    // Declared as a plain .docx; the sniffer reads the bytes and finds the macro-enabled type,
    // which the allow-list does not name.
    const refused = await uploadFile(cookie, created.id, DOCM, 'draft.docx', DOCX_TYPE).expect(415);
    expect(refused.body.error.message).toMatch(/Convert other Office documents to PDF/);
  });

  /*
   * D-82 promises inline preview for clean PDFs and images only. Office documents are storable
   * but not renderable, which is why the previewable set is no longer the allow-list itself.
   */
  it('refuses to preview a Word document even when it is clean', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie);
    const uploaded = await uploadFile(cookie, created.id, DOCX, 'draft.docx', DOCX_TYPE).expect(
      201,
    );
    const versionId = dataOf<{ id: string }>(uploaded).id;

    await markScanned(versionId);

    await request(server())
      .get(`/api/v1/documents/${created.id}/attachments/${versionId}/content`)
      .set('Cookie', cookie)
      .expect(415);
  });

  /*
   * D-83 with D-71: a release has to be evidenced by a fixed artefact. A .docx can be perfectly
   * clean and still be the wrong thing to release, because two people holding it can read
   * different text.
   */
  it('blocks release when the current clean attachment is editable', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie); // version 1

    const uploaded = await uploadFile(cookie, created.id, DOCX, 'letter.docx', DOCX_TYPE).expect(
      201,
    ); // -> 2
    const versionId = dataOf<{ id: string }>(uploaded).id;

    await markScanned(versionId);

    await act(cookie, created.id, 'ACCEPT', { expectedVersion: 2 }).expect(201); // stays 2
    await act(cookie, created.id, 'SUBMIT_FOR_SIGNATURE', { expectedVersion: 2 }).expect(201); // -> 3
    await act(await directorLogin(), created.id, 'SIGN', { expectedVersion: 3 }).expect(201); // -> 4
    await act(cookie, created.id, 'PREPARE_RELEASE', { expectedVersion: 4 }).expect(201); // -> 5

    const blocked = await act(cookie, created.id, 'RELEASE', {
      expectedVersion: 5,
      releaseMethod: 'EMAILED',
    }).expect(422);
    expect(blocked.body.error.code).toBe('RELEASE_BLOCKED');
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

    await markScanned(versionId);

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
    await markScanned(versionId);

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

  describe('rescan', () => {
    const uploadPending = async (cookie: string[]) => {
      const created = await createOutgoing(cookie);
      const uploaded = await uploadFile(
        cookie,
        created.id,
        PDF,
        'plan.pdf',
        'application/pdf',
      ).expect(201);
      return { documentId: created.id, versionId: dataOf<{ id: string }>(uploaded).id };
    };
    const scanEvents = (versionId: string) =>
      app
        .get<InMemoryOutboxWriter>(OutboxWriter)
        .events.filter((event) => event.aggregateId === versionId);

    it('is the only way to ask for a scan: a submitted verdict has no route', async () => {
      const cookie = await login('records@dts.local', 'Records@1234!');
      const { documentId, versionId } = await uploadPending(cookie);
      await request(server())
        .post(`/api/v1/documents/${documentId}/attachments/${versionId}/scan`)
        .set('Cookie', cookie)
        .send({ status: 'CLEAN' })
        .expect(404);
      await request(server())
        .get(`/api/v1/documents/${documentId}/attachments/${versionId}/download`)
        .set('Cookie', cookie)
        .expect(409);
    });

    it('queues another scan of a pending version and leaves it pending', async () => {
      const cookie = await login('records@dts.local', 'Records@1234!');
      const { documentId, versionId } = await uploadPending(cookie);
      expect(scanEvents(versionId)).toHaveLength(1);

      const response = await request(server())
        .post(`/api/v1/documents/${documentId}/attachments/${versionId}/rescan`)
        .set('Cookie', cookie)
        .expect(201);
      expect(dataOf<{ scanStatus: string }>(response).scanStatus).toBe('PENDING');
      expect(scanEvents(versionId)).toHaveLength(2);
    });

    it('does nothing to a version that already has a final result', async () => {
      const cookie = await login('records@dts.local', 'Records@1234!');
      const { documentId, versionId } = await uploadPending(cookie);
      await markScanned(versionId, 'INFECTED');

      const response = await request(server())
        .post(`/api/v1/documents/${documentId}/attachments/${versionId}/rescan`)
        .set('Cookie', cookie)
        .expect(201);
      expect(dataOf<{ scanStatus: string }>(response).scanStatus).toBe('INFECTED');
      expect(scanEvents(versionId)).toHaveLength(1);
    });

    it('is refused to a caller without FILE_SCAN_RECORD', async () => {
      const staff = await login('staff@dts.local', 'Staff@12345!');
      const created = await request(server())
        .post('/api/v1/documents')
        .set('Cookie', staff)
        .send({
          title: 'Staff memorandum',
          type: 'MEMORANDUM',
          priority: 'NORMAL',
          direction: 'OUTGOING',
          divisionId: 'division-pilot',
          sectionId: 'section-pilot',
        })
        .expect(201);
      const documentId = dataOf<{ id: string }>(created).id;
      const uploaded = await uploadFile(
        staff,
        documentId,
        PDF,
        'plan.pdf',
        'application/pdf',
      ).expect(201);
      const versionId = dataOf<{ id: string }>(uploaded).id;

      await request(server())
        .post(`/api/v1/documents/${documentId}/attachments/${versionId}/rescan`)
        .set('Cookie', staff)
        .expect(403);
      expect(scanEvents(versionId)).toHaveLength(1);
    });
  });

  it('refuses a new attachment on a document that was released after the editable check', async () => {
    const cookie = await login('records@dts.local', 'Records@1234!');
    const created = await createOutgoing(cookie);
    const documents = app.get(DocumentsRepository);
    const row = await documents.findById(created.id);
    if (row === null) throw new Error('document missing');
    // Released between the service's check and the pointer update, which is the window the
    // repository's own status predicate closes.
    (documents as unknown as InMemoryDocumentsRepository).setStatusForTest(created.id, 'RELEASED');
    await expect(documents.setCurrentFileVersion(created.id, 'any-version')).rejects.toMatchObject({
      response: { code: 'DOCUMENT_NOT_EDITABLE' },
    });
  });
});
