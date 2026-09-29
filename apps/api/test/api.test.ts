import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
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

const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

describe('REST /api/v1 public seam', () => {
  let app: INestApplication;

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

  it('logs in, creates an incoming document, and executes the allowed accept action', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: 'Records@1234!' })
      .expect(201);

    const cookie = sessionCookie(login);

    const created = await request(app.getHttpServer())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Incoming request',
        type: 'MEMORANDUM',
        description: 'Please review.',
        priority: 'HIGH',
        direction: 'INCOMING',
        sender: 'Citizen One',
        company: 'Public',
        referenceNumber: 'EXT-2026-1',
        divisionId: 'division-records',
        sectionId: 'section-intake',
      })
      .expect(201);

    expect(created.body.data).toMatchObject({ status: 'PENDING', version: 1 });

    const allowed = await request(app.getHttpServer())
      .get(`/api/v1/documents/${created.body.data.id}/allowed-actions`)
      .set('Cookie', cookie)
      .expect(200);
    expect(allowed.body.data).toContain('ACCEPT');

    const accepted = await request(app.getHttpServer())
      .post(`/api/v1/documents/${created.body.data.id}/actions/ACCEPT`)
      .set('Cookie', cookie)
      .send({ expectedVersion: 1 })
      .expect(201);
    expect(accepted.body.data).toMatchObject({ status: 'IN_PROCESS', version: 2 });
  });

  it('never returns inaccessible cross-division documents in search totals', async () => {
    const recordsLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: 'Records@1234!' })
      .expect(201);
    const recordsCookie = sessionCookie(recordsLogin);

    await request(app.getHttpServer())
      .post('/api/v1/documents')
      .set('Cookie', recordsCookie)
      .send({
        title: 'Cross division secret',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'External',
        divisionId: 'division-other',
        sectionId: 'section-other',
      })
      .expect(201);

    const staffLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'staff@dts.local', password: 'Staff@12345!' })
      .expect(201);
    const staffCookie = sessionCookie(staffLogin);

    const search = await request(app.getHttpServer())
      .get('/api/v1/documents?search=Cross%20division%20secret')
      .set('Cookie', staffCookie)
      .expect(200);
    expect(search.body.data.total).toBe(0);
  });

  it('audits every report and routing-slip export as a distinct download event', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'records@dts.local', password: 'Records@1234!' })
      .expect(201);
    const cookie = sessionCookie(login);

    const created = await request(app.getHttpServer())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Report subject',
        type: 'MEMORANDUM',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'Citizen',
        divisionId: 'division-records',
        sectionId: 'section-intake',
      })
      .expect(201);
    const documentId = created.body.data.id as string;

    const audit = app.get(AuditWriter);
    if (!(audit instanceof InMemoryAuditWriter))
      throw new Error('expected the in-memory audit writer to be wired in');
    audit.entries.length = 0; // ignore the create/accept trail; assert only on the exports below

    await request(app.getHttpServer())
      .get('/api/v1/reports/monthly.xlsx?year=2026&month=9')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/reports/monthly.pdf?year=2026&month=9')
      .set('Cookie', cookie)
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/v1/documents/${documentId}/routing-slip.pdf`)
      .set('Cookie', cookie)
      .expect(200);

    const exports = audit.entries
      .filter((entry) =>
        ['report.exported', 'document.routing-slip-exported'].includes(entry.action),
      )
      .map((entry) => ({
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        outcome: entry.outcome,
        summary: entry.summary,
      }));
    expect(exports).toEqual([
      {
        action: 'report.exported',
        targetType: 'report',
        targetId: '2026-9',
        outcome: 'SUCCESS',
        summary: { format: 'xlsx', year: 2026, month: 9 },
      },
      {
        action: 'report.exported',
        targetType: 'report',
        targetId: '2026-9',
        outcome: 'SUCCESS',
        summary: { format: 'pdf', year: 2026, month: 9 },
      },
      {
        action: 'document.routing-slip-exported',
        targetType: 'document',
        targetId: documentId,
        outcome: 'SUCCESS',
        summary: { format: 'pdf' },
      },
    ]);
    // The export trail must never carry document body text or party names — IDs, format and
    // period only (audit policy P-14).
    for (const entry of exports) {
      expect(JSON.stringify(entry.summary)).not.toContain('Report subject');
      expect(JSON.stringify(entry.summary)).not.toContain('Citizen');
    }
  });
});
