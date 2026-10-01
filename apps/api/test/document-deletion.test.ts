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
 * Logical deletion, end to end over HTTP.
 *
 * The behaviour worth pinning here is the *round trip*: a deleted document disappears from every
 * read path, and the only way back is the deleted-items list, which has to carry the current
 * version or restore cannot be called at all. Each half is unremarkable on its own; it is the
 * pairing that the UI depends on and that a scope change could silently break.
 */

const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

const dataOf = <T>(response: { body: unknown }): T => (response.body as { data: T }).data;

interface DocumentShape {
  id: string;
  version: number;
  trackingNumber: string;
  title: string;
}

describe('REST /api/v1 document deletion and restore', () => {
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

  const login = async (email: string, password: string): Promise<string[]> => {
    const response = await request(server())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(201);
    return sessionCookie(response);
  };

  const createDocument = async (cookie: string[]): Promise<DocumentShape> => {
    const response = await request(server())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Superseded circular',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'OUTGOING',
        divisionId: 'division-records',
      })
      .expect(201);
    return dataOf<DocumentShape>(response);
  };

  it('hides a deleted document from reads, then restores it from the deleted list', async () => {
    const cookie = await login('admin@dts.local', 'Admin@12345!');
    const created = await createDocument(cookie);

    await request(server())
      .delete(`/api/v1/documents/${created.id}`)
      .set('Cookie', cookie)
      .send({ expectedVersion: created.version })
      .expect(200);

    // Gone from the detail route and from the registry, not merely flagged.
    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', cookie)
      .expect(404);
    const registry = await request(server())
      .get('/api/v1/documents')
      .set('Cookie', cookie)
      .expect(200);
    expect(dataOf<{ items: DocumentShape[] }>(registry).items).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );

    // The deleted list is the only remaining way to find it — and it carries the version that
    // restore requires, which is the whole reason the endpoint exists.
    const deleted = await request(server())
      .get('/api/v1/documents/deleted')
      .set('Cookie', cookie)
      .expect(200);
    const row = dataOf<DocumentShape[]>(deleted).find((entry) => entry.id === created.id);
    expect(row).toMatchObject({ trackingNumber: created.trackingNumber });

    await request(server())
      .post(`/api/v1/documents/${created.id}/restore`)
      .set('Cookie', cookie)
      .send({ expectedVersion: row?.version })
      .expect(201);

    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', cookie)
      .expect(200);
    const afterRestore = await request(server())
      .get('/api/v1/documents/deleted')
      .set('Cookie', cookie)
      .expect(200);
    expect(dataOf<DocumentShape[]>(afterRestore)).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
  });

  it('refuses deletion to a role without DOCUMENT_DELETE and keeps the document readable', async () => {
    const admin = await login('admin@dts.local', 'Admin@12345!');
    const created = await createDocument(admin);
    const records = await login('records@dts.local', 'Records@1234!');

    await request(server())
      .delete(`/api/v1/documents/${created.id}`)
      .set('Cookie', records)
      .send({ expectedVersion: created.version })
      .expect(403);

    await request(server())
      .get(`/api/v1/documents/${created.id}`)
      .set('Cookie', records)
      .expect(200);
  });

  it('offers nothing in the deleted list to a caller who could not restore it', async () => {
    const admin = await login('admin@dts.local', 'Admin@12345!');
    const created = await createDocument(admin);
    await request(server())
      .delete(`/api/v1/documents/${created.id}`)
      .set('Cookie', admin)
      .send({ expectedVersion: created.version })
      .expect(200);

    const records = await login('records@dts.local', 'Records@1234!');
    const deleted = await request(server())
      .get('/api/v1/documents/deleted')
      .set('Cookie', records)
      .expect(200);
    expect(dataOf<DocumentShape[]>(deleted)).toEqual([]);
  });

  it('rejects a restore against a stale version rather than reviving the wrong state', async () => {
    const cookie = await login('admin@dts.local', 'Admin@12345!');
    const created = await createDocument(cookie);
    await request(server())
      .delete(`/api/v1/documents/${created.id}`)
      .set('Cookie', cookie)
      .send({ expectedVersion: created.version })
      .expect(200);

    // `created.version` is the pre-deletion version; deleting bumped it.
    await request(server())
      .post(`/api/v1/documents/${created.id}/restore`)
      .set('Cookie', cookie)
      .send({ expectedVersion: created.version })
      .expect(409);
  });
});
