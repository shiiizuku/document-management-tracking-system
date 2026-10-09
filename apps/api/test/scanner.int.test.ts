import 'reflect-metadata';
import { hashSync } from 'bcryptjs';
import cookieParser from 'cookie-parser';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Queue, Worker } from 'bullmq';
import request from 'supertest';
import type { Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { DATABASE } from '../src/database/database.constants.js';
import type { Database } from '../src/database/client.js';
import { divisions, sections } from '../src/database/schema.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { createOutboxQueue, createOutboxWorker } from '../src/modules/jobs/outbox-queue.js';
import { OutboxRelay } from '../src/modules/jobs/outbox-relay.js';
import { ClamAvScanner } from '../src/modules/files/clamav-scanner.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { StoragePort } from '../src/modules/files/storage.port.js';
import { scanUploadedVersion } from '../src/modules/files/scan-consumer.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive scanner int test');
const redisUrl = process.env.REDIS_URL;
if (!redisUrl) throw new Error('REDIS_URL is required for the scanner integration test');

const RECORDS_PASSWORD = 'RecordsPass1234!';
const DIV = '00000000-0000-4000-9000-0000000000c0';
const SEC = '00000000-0000-4000-9000-0000000000c1';

/*
 * The EICAR test file: the industry-standard 68-byte string every scanner detects and nothing
 * else does. Held as base64 so this source file is not itself a virus-scanner detection — a
 * repository that trips the developer's own desktop scanner on checkout is its own outage.
 */
const EICAR = Buffer.from(
  'WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=',
  'base64',
);

/*
 * The EICAR bytes inside a PDF, because the upload gate sniffs the real media type from the magic
 * bytes and plain text is refused before it ever reaches the scanner (`UNSUPPORTED_MEDIA_TYPE`).
 * A plain-text EICAR upload would therefore prove the sniffer, not the scanner. clamd detects the
 * signature inside the PDF stream, so this is a file the system accepts and the scanner condemns —
 * exactly the case the fail-closed download path exists for.
 */
const INFECTED_PDF = Buffer.concat([
  Buffer.from(`%PDF-1.7\n1 0 obj<</Length ${EICAR.byteLength}>>stream\n`),
  EICAR,
  Buffer.from('\nendstream endobj\ntrailer<<>>\n%%EOF\n'),
]);
const CLEAN_PDF = Buffer.from('%PDF-1.7\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

interface ListedVersion {
  id: string;
  scanStatus: string;
}

describe('attachment scanning against real ClamAV, MinIO and Redis', () => {
  let app: INestApplication;
  let queue: Queue;
  let worker: Worker;
  let cookies: string[];
  let relay: OutboxRelay;
  const server = (): Server => app.getHttpServer() as Server;

  const createDoc = async (title: string): Promise<{ id: string }> =>
    dataOf<{ id: string }>(
      await request(server())
        .post('/api/v1/documents')
        .set('Cookie', cookies)
        .send({
          title,
          type: 'MEMORANDUM',
          priority: 'NORMAL',
          direction: 'INCOMING',
          sender: 'External',
          divisionId: DIV,
          sectionId: SEC,
        })
        .expect(201),
    );

  const upload = async (documentId: string, bytes: Buffer): Promise<ListedVersion> =>
    dataOf<ListedVersion>(
      await request(server())
        .post(`/api/v1/documents/${documentId}/attachments`)
        .set('Cookie', cookies)
        .attach('file', bytes, { filename: 'plan.pdf', contentType: 'application/pdf' })
        .expect(201),
    );

  const scanStatusOf = async (documentId: string, versionId: string): Promise<string> => {
    const listed = dataOf<{ versions: ListedVersion[] }[]>(
      await request(server())
        .get(`/api/v1/documents/${documentId}/attachments`)
        .set('Cookie', cookies)
        .expect(200),
    );
    const version = listed
      .flatMap((attachment) => attachment.versions)
      .find((candidate) => candidate.id === versionId);
    if (version === undefined) throw new Error(`version ${versionId} is not listed`);
    return version.scanStatus;
  };

  /**
   * Publishes the committed `attachment.uploaded` event and waits for the worker to have recorded
   * a verdict, polling the API rather than listening for a job event: the relay and the worker are
   * the production path, and what the rest of the system reads is the version row they leave
   * behind. A clamd that has just started can take several seconds to answer.
   */
  const awaitScanVerdict = async (documentId: string, versionId: string): Promise<string> => {
    await relay.drain();
    const deadline = Date.now() + 60_000;
    for (;;) {
      const status = await scanStatusOf(documentId, versionId);
      if (status !== 'PENDING') return status;
      if (Date.now() > deadline) throw new Error(`version ${versionId} is still PENDING`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };

  beforeAll(async () => {
    // No provider overrides at all: bytes go to the real MinIO bucket and the verdict comes from
    // the real clamd in docker-compose.yml. That is the point of this suite.
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
    await database
      .insert(divisions)
      .values({ id: DIV, code: 'ORD', name: 'Office of the Regional Director' });
    await database
      .insert(sections)
      .values({ id: SEC, divisionId: DIV, code: 'S1', name: 'Scanner Section' });
    await app.get(UsersRepository).insert({
      email: 'records@dts.local',
      displayName: 'Records Officer',
      passwordHash: hashSync(RECORDS_PASSWORD, 4),
      role: 'RECORDS_STAFF',
      divisionId: DIV,
      sectionId: SEC,
      canAccessConfidential: true,
    });

    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: RECORDS_PASSWORD })
      .expect(201);
    const raw = (login.headers as Record<string, string | string[] | undefined>)['set-cookie'];
    const setCookies: string[] = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    cookies = setCookies.map((entry) => entry.split(';')[0] ?? '');

    queue = createOutboxQueue(redisUrl);
    await queue.obliterate({ force: true }); // leftovers from a previous run would be re-scanned
    relay = new OutboxRelay(database, queue);

    // The worker's own scan branch, built from the same collaborators `worker.ts` builds it from,
    // so what is exercised here is the consumer that runs in production rather than a stand-in.
    const scanner = new ClamAvScanner({
      host: process.env.CLAMAV_HOST ?? 'localhost',
      port: Number(process.env.CLAMAV_PORT ?? 3311),
    });
    const deps = {
      versions: app.get(FileVersionsRepository),
      storage: app.get<StoragePort>(StoragePort),
      scanner,
    };
    worker = createOutboxWorker(redisUrl, async (job) => {
      if (job.data.eventType !== 'attachment.uploaded') return;
      const versionId = job.data.payload.versionId;
      if (typeof versionId !== 'string')
        throw new Error(`attachment.uploaded event ${job.data.outboxId} has no versionId`);
      await scanUploadedVersion(deps, versionId);
    });
  }, 60_000);

  afterAll(async () => {
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await app.close();
  });

  it('condemns an infected upload and keeps the download closed', async () => {
    const doc = await createDoc('Incoming with an infected attachment');
    const version = await upload(doc.id, INFECTED_PDF);
    expect(version.scanStatus).toBe('PENDING');

    expect(await awaitScanVerdict(doc.id, version.id)).toBe('INFECTED');

    const blocked = await request(server())
      .get(`/api/v1/documents/${doc.id}/attachments/${version.id}/download`)
      .set('Cookie', cookies)
      .expect(409);
    expect(blocked.body.error.code).toBe('FILE_NOT_CLEAN');

    // The preview path is the other door to the same bytes, and it is closed too.
    await request(server())
      .get(`/api/v1/documents/${doc.id}/attachments/${version.id}/content`)
      .set('Cookie', cookies)
      .expect(409);

    // The verdict is final, and nobody can submit one: the old manual-verdict route is gone, so the
    // download stays shut.
    await request(server())
      .post(`/api/v1/documents/${doc.id}/attachments/${version.id}/scan`)
      .set('Cookie', cookies)
      .send({ status: 'CLEAN' })
      .expect(404);
    expect(await scanStatusOf(doc.id, version.id)).toBe('INFECTED');
  }, 120_000);

  it('passes a clean upload and serves the stored bytes back', async () => {
    const doc = await createDoc('Incoming with a clean attachment');
    const version = await upload(doc.id, CLEAN_PDF);

    expect(await awaitScanVerdict(doc.id, version.id)).toBe('CLEAN');

    const download = await request(server())
      .get(`/api/v1/documents/${doc.id}/attachments/${version.id}/download`)
      .set('Cookie', cookies)
      .responseType('blob')
      .expect(200);
    expect((download.body as Buffer).equals(CLEAN_PDF)).toBe(true);
  }, 120_000);
});
