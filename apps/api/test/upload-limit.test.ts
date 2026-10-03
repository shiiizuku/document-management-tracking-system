import 'reflect-metadata';
// Must precede the app module: it is what narrows the limit the module validates on import.
import { CONFIGURED_MAX_BYTES, UPLOAD_MAX_BYTES_BEFORE } from './narrow-upload-limit.js';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';
import { OutboxWriter } from '../src/modules/audit/outbox.writer.js';
import { DATABASE } from '../src/database/database.constants.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { MAX_ATTACHMENT_BYTES } from '../src/modules/files/media-types.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryDocumentsRepository } from './in-memory-documents.repository.js';
import { InMemoryFileVersionsRepository } from './in-memory-file-versions.repository.js';
import { InMemoryOutboxWriter } from './in-memory-outbox.writer.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';
import { InMemoryStorageAdapter, StoragePort } from '../src/modules/files/storage.port.js';
import { fakeTransactionalDatabase } from './test-database.js';
import { validateEnvironment } from '../src/config/environment.js';

/*
 * The upload size limit, which until now was configuration nothing read.
 *
 * A suite of its own because the limit is fixed before the app module is even imported (see
 * ./narrow-upload-limit.ts), so it cannot be varied case by case. Its 4 KiB keeps the refused
 * upload small enough to stay in memory and far enough below the compiled ceiling that the
 * refusal can only have come from configuration.
 */
const PDF_HEADER = '%PDF-1.7\n1 0 obj<<>>endobj\n';
const PDF_TRAILER = '\ntrailer<<>>\n%%EOF\n';

// A PDF whose magic bytes sniff correctly, padded one byte past the configured limit with PDF
// comment lines. The size check has to be what refuses this, not the media-type sniffer.
const oversizePdf = (): Buffer => {
  const header = Buffer.from(PDF_HEADER);
  const trailer = Buffer.from(PDF_TRAILER);
  const padding = Buffer.alloc(CONFIGURED_MAX_BYTES + 1 - header.byteLength - trailer.byteLength);
  padding.fill('% padding\n');
  return Buffer.concat([header, padding, trailer]);
};
const withinLimitPdf = Buffer.from(PDF_HEADER + PDF_TRAILER);

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

describe('the configured upload size limit', () => {
  let app: INestApplication;
  let cookie: string[];
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
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

    const login = await request(server())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: 'Records@1234!' })
      .expect(201);
    const raw = (login.headers as Record<string, string | string[] | undefined>)['set-cookie'];
    cookie = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  });

  afterAll(async () => {
    await app.close();
    // The variable is process-wide; leaving it narrowed would quietly shrink the limit for any
    // suite that runs after this one in the same worker.
    if (UPLOAD_MAX_BYTES_BEFORE === undefined) delete process.env.UPLOAD_MAX_BYTES;
    else process.env.UPLOAD_MAX_BYTES = UPLOAD_MAX_BYTES_BEFORE;
  });

  const createDocument = async (): Promise<{ id: string }> =>
    dataOf<{ id: string }>(
      await request(server())
        .post('/api/v1/documents')
        .set('Cookie', cookie)
        .send({
          title: 'Document with an oversize attachment',
          type: 'MEMORANDUM',
          priority: 'NORMAL',
          direction: 'OUTGOING',
          divisionId: 'division-records',
          sectionId: 'section-intake',
        })
        .expect(201),
    );

  const upload = async (buffer: Buffer, expectedStatus: number) => {
    const document = await createDocument();
    return request(server())
      .post(`/api/v1/documents/${document.id}/attachments`)
      .set('Cookie', cookie)
      .attach('file', buffer, { filename: 'plan.pdf', contentType: 'application/pdf' })
      .expect(expectedStatus);
  };

  it('refuses an upload over the configured limit', async () => {
    const refused = await upload(oversizePdf(), 413);
    expect(refused.body.error.code).toBe('FILE_TOO_LARGE');
    expect(refused.body.error.message).toContain(String(CONFIGURED_MAX_BYTES));
  });

  it('accepts an upload under it, so the refusal is the size and nothing else', async () => {
    const accepted = await upload(withinLimitPdf, 201);
    expect(dataOf<{ scanStatus: string }>(accepted).scanStatus).toBe('PENDING');
  });

  it('refuses to boot with a limit above the compiled parser ceiling', () => {
    const environment = { ...process.env, UPLOAD_MAX_BYTES: String(MAX_ATTACHMENT_BYTES + 1) };
    expect(() => validateEnvironment(environment)).toThrow(/UPLOAD_MAX_BYTES must not exceed/);
  });
});
