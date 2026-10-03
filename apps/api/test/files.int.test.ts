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
import { divisions, sections } from '../src/database/schema.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryStorageAdapter, StoragePort } from '../src/modules/files/storage.port.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive files int test');

const RECORDS_PASSWORD = 'RecordsPass1234!';
const DIRECTOR_PASSWORD = 'DirectorPass1234!';
const DIV = '00000000-0000-4000-9000-0000000000f0';
const SEC = '00000000-0000-4000-9000-0000000000f1';
// A genuinely PDF-sniffable buffer, and plain text wearing a PDF label.
const PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const SPOOF = Buffer.from('this is definitely not a pdf, just plain text pretending to be one');

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

describe('attachment files REST against a real database', () => {
  let app: INestApplication;
  let cookies: string[];
  // Signing is the Director's alone (ADR-0006), so the one outgoing test below changes actor for
  // that step. The Director reads across the office, so it needs no placement in this suite's ORD.
  let directorCookies: string[];
  const server = (): Server => app.getHttpServer() as Server;

  const createDoc = async (direction: 'INCOMING' | 'OUTGOING'): Promise<{ id: string }> =>
    dataOf<{ id: string }>(
      await request(server())
        .post('/api/v1/documents')
        .set('Cookie', cookies)
        .send({
          title: `${direction} with attachment`,
          type: 'MEMORANDUM',
          priority: 'NORMAL',
          direction,
          ...(direction === 'INCOMING' ? { sender: 'External' } : {}),
          divisionId: DIV,
          sectionId: SEC,
        })
        .expect(201),
    );

  const upload = (documentId: string, buffer: Buffer, filename: string, contentType: string) =>
    request(server())
      .post(`/api/v1/documents/${documentId}/attachments`)
      .set('Cookie', cookies)
      .attach('file', buffer, { filename, contentType });

  const scan = (documentId: string, versionId: string, status: string) =>
    request(server())
      .post(`/api/v1/documents/${documentId}/attachments/${versionId}/scan`)
      .set('Cookie', cookies)
      .send({ status });

  beforeAll(async () => {
    // This suite proves the Postgres metadata + fail-closed download paths; the bytes stay in an
    // in-memory adapter so it needs no MinIO service (CI provisions only Postgres + Redis).
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StoragePort)
      .useClass(InMemoryStorageAdapter)
      .compile();
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
    /*
     * Coded ORD because this suite drives the outgoing path end to end as the records officer.
     * The revision makes the Records Unit a Section within the Office of the Regional Director
     * (decision 152), and an ORD draft skips the division head's initial — its head is the
     * Director, so requiring one would have the same person initial and sign (ADR-0007).
     */
    await database
      .insert(divisions)
      .values({ id: DIV, code: 'ORD', name: 'Office of the Regional Director' });
    await database
      .insert(sections)
      .values({ id: SEC, divisionId: DIV, code: 'F1', name: 'Files Section' });
    await app.get(UsersRepository).insert({
      email: 'director@dts.local',
      displayName: 'Regional Director',
      passwordHash: hashSync(DIRECTOR_PASSWORD, 4),
      role: 'DIRECTOR',
      // Placed in the ORD and given no section: the Director belongs to a division but is never
      // narrowed by it, which is the whole shape of the role.
      divisionId: DIV,
      sectionId: null,
      canAccessConfidential: true,
    });
    await app.get(UsersRepository).insert({
      email: 'records@dts.local',
      displayName: 'Records Officer',
      passwordHash: hashSync(RECORDS_PASSWORD, 4),
      role: 'RECORDS_STAFF',
      // Placed in the ORD's records section, so this officer is the recipient of the hop that
      // registration creates and can therefore accept custody of what it registers.
      divisionId: DIV,
      sectionId: SEC,
      canAccessConfidential: true,
    });

    const signIn = async (email: string, password: string): Promise<string[]> => {
      const login = await request(server())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(201);
      const raw = (login.headers as Record<string, string | string[] | undefined>)['set-cookie'];
      const setCookies: string[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      return setCookies.map((entry) => entry.split(';')[0] ?? '');
    };
    cookies = await signIn('records@dts.local', RECORDS_PASSWORD);
    directorCookies = await signIn('director@dts.local', DIRECTOR_PASSWORD);
  }, 30_000);

  afterAll(async () => {
    await app.close();
  });

  it('persists a version, quarantines it, and serves the bytes only after a clean scan', async () => {
    const doc = await createDoc('INCOMING');
    const version = dataOf<{ id: string; versionNumber: number; scanStatus: string }>(
      await upload(doc.id, PDF, 'plan.pdf', 'application/pdf').expect(201),
    );
    expect(version).toMatchObject({ versionNumber: 1, scanStatus: 'PENDING' });

    // Fail-closed while pending.
    const blocked = await request(server())
      .get(`/api/v1/documents/${doc.id}/attachments/${version.id}/download`)
      .set('Cookie', cookies)
      .expect(409);
    expect(blocked.body.error.code).toBe('FILE_NOT_CLEAN');

    await scan(doc.id, version.id, 'CLEAN').expect(201);

    // The version metadata survives independently of the request that created it: list reads
    // it back from Postgres.
    const listed = dataOf<
      { attachmentId: string; versions: { id: string; scanStatus: string }[] }[]
    >(
      await request(server())
        .get(`/api/v1/documents/${doc.id}/attachments`)
        .set('Cookie', cookies)
        .expect(200),
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]!.versions[0]).toMatchObject({ id: version.id, scanStatus: 'CLEAN' });

    const download = await request(server())
      .get(`/api/v1/documents/${doc.id}/attachments/${version.id}/download`)
      .set('Cookie', cookies)
      .responseType('blob')
      .expect(200);
    expect(download.headers['x-content-type-options']).toBe('nosniff');
    expect((download.body as Buffer).equals(PDF)).toBe(true);
  }, 30_000);

  it('rejects a spoofed media type from its real bytes', async () => {
    const doc = await createDoc('INCOMING');
    const rejected = await upload(doc.id, SPOOF, 'evil.pdf', 'application/pdf').expect(415);
    expect(rejected.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
  }, 30_000);

  it('treats a final scan result as immutable', async () => {
    const doc = await createDoc('INCOMING');
    const version = dataOf<{ id: string }>(
      await upload(doc.id, PDF, 'plan.pdf', 'application/pdf').expect(201),
    );
    await scan(doc.id, version.id, 'CLEAN').expect(201);
    const conflict = await scan(doc.id, version.id, 'INFECTED').expect(409);
    expect(conflict.body.error.code).toBe('SCAN_RESULT_CONFLICT');
  }, 30_000);

  it('does not resolve a version through a sibling document (IDOR)', async () => {
    const docA = await createDoc('INCOMING');
    const docB = await createDoc('INCOMING');
    const version = dataOf<{ id: string }>(
      await upload(docA.id, PDF, 'plan.pdf', 'application/pdf').expect(201),
    );
    await request(server())
      .get(`/api/v1/documents/${docB.id}/attachments/${version.id}/download`)
      .set('Cookie', cookies)
      .expect(404);
  }, 30_000);

  it('records a persisted signature event against the signed version', async () => {
    const doc = await createDoc('OUTGOING'); // v1
    const version = dataOf<{ id: string }>(
      await upload(doc.id, PDF, 'plan.pdf', 'application/pdf').expect(201),
    ); // v2
    await scan(doc.id, version.id, 'CLEAN').expect(201);

    const act = (action: string, expectedVersion: number, as: string[] = cookies) =>
      request(server())
        .post(`/api/v1/documents/${doc.id}/actions/${action}`)
        .set('Cookie', as)
        .send({ expectedVersion });
    // Accepting stamps the route row and leaves the document's version alone.
    await act('ACCEPT', 2).expect(201); // still v2
    await act('SUBMIT_FOR_SIGNATURE', 2).expect(201); // v3
    // The custodian carries it to the signature line and no further: records staff lost
    // `DOCUMENT_SIGN` with ADR-0006, and the refusal here is the live proof of that reduction.
    await act('SIGN', 3).expect(403);
    const signed = dataOf<{ signedAttachmentVersionId: string | null }>(
      await act('SIGN', 3, directorCookies).expect(201),
    ); // v4
    expect(signed.signedAttachmentVersionId).toBe(version.id);

    const detail = dataOf<{ signatures: { fileVersionId: string }[] }>(
      await request(server()).get(`/api/v1/documents/${doc.id}`).set('Cookie', cookies).expect(200),
    );
    expect(detail.signatures).toHaveLength(1);
    expect(detail.signatures[0]!.fileVersionId).toBe(version.id);
  }, 30_000);
});
