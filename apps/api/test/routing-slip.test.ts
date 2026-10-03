import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { Test } from '@nestjs/testing';
import { type INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import type { RequestUser } from '../src/common/request-user.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';
import { capabilitiesByRole } from '../src/modules/authorization/role-capabilities.js';
import { OutboxWriter } from '../src/modules/audit/outbox.writer.js';
import { DATABASE } from '../src/database/database.constants.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { DocumentsService } from '../src/modules/documents/documents.service.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { ReportExportService } from '../src/modules/reports/report-export.service.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';
import { InMemoryAuditWriter } from './in-memory-audit.writer.js';
import { InMemoryDocumentsRepository } from './in-memory-documents.repository.js';
import { InMemoryFileVersionsRepository } from './in-memory-file-versions.repository.js';
import { InMemoryOutboxWriter } from './in-memory-outbox.writer.js';
import { InMemoryUsersRepository } from './in-memory-users.repository.js';
import { fakeTransactionalDatabase } from './test-database.js';

/**
 * The routing slip's rows (decisions 160, 171).
 *
 * The slip is the output ADR-0005 moved custody onto the route row *for*, and the rule that is
 * easiest to get quietly wrong is the one about who gets a row: a for-information recipient reads
 * and remarks and never takes custody, so printing one as a routing row would make the slip say
 * three divisions held a document that one division held. That is a claim about the resolved rows,
 * not about the rendered PDF, so it is asserted against `routingSlip` rather than by reading bytes
 * back out of PDFKit.
 */
const sessionCookie = (response: {
  headers: Record<string, string | string[] | undefined>;
}): string[] => {
  const cookie = response.headers['set-cookie'];
  if (cookie === undefined) throw new Error('Login did not set a session cookie');
  return Array.isArray(cookie) ? cookie : [cookie];
};

describe('routing slip', () => {
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

  const asRecords = async (): Promise<string[]> =>
    sessionCookie(
      await request(server())
        .post('/api/v1/auth/login')
        .send({ email: 'records@dts.local', password: 'Records@1234!' })
        .expect(201),
    );

  /*
   * The seeded records officer as the service wants them. `routingSlip` is called directly rather
   * than over HTTP because what is under test is the resolved rows, and the routes serve a PDF —
   * asserting on which divisions got a row by reading bytes back out of PDFKit would test the
   * renderer instead of the rule.
   */
  const recordsOfficer = async (): Promise<RequestUser> => {
    const users = app.get<InMemoryUsersRepository>(UsersRepository);
    const actor = await users.findByEmail('records@dts.local');
    if (actor === null) throw new Error('expected the seeded records officer');
    return {
      id: actor.id,
      role: actor.role,
      divisionId: actor.divisionId,
      sectionId: actor.sectionId,
      email: actor.email,
      displayName: actor.displayName,
      active: actor.active,
      capabilities: capabilitiesByRole[actor.role],
      canAccessConfidential: actor.canAccessConfidential,
    };
  };

  const register = async (cookie: string[]): Promise<{ id: string; version: number }> => {
    const created = await request(server())
      .post('/api/v1/documents')
      .set('Cookie', cookie)
      .send({
        title: 'Request for ore transport permits',
        type: 'LETTER',
        priority: 'NORMAL',
        direction: 'INCOMING',
        sender: 'Solid North Mineral Corporation',
        divisionId: 'division-records',
        sectionId: 'section-intake',
      })
      .expect(201);
    return created.body.data as { id: string; version: number };
  };

  it('prints one row per custody hop and none for a for-information recipient', async () => {
    const cookie = await asRecords();
    const document = await register(cookie);

    const routed = await request(server())
      .post(`/api/v1/documents/${document.id}/routes`)
      .set('Cookie', cookie)
      .send({
        expectedVersion: document.version,
        toDivisionId: 'division-legal',
        forInformationDivisionIds: ['division-finance', 'division-planning'],
        remarks: 'For evaluation and appropriate action',
      })
      .expect(201);
    // Four route rows: the intake hop written at registration, the forward, and two copies.
    expect(routed.body.data.routes).toHaveLength(4);

    const documents = app.get(DocumentsService);
    const actor = await recordsOfficer();

    const slip = await documents.routingSlip(actor, document.id);

    // Four route rows, two hops: the two copies get no rows of their own, and are named against
    // the hop that consulted them instead.
    expect(slip.hops).toHaveLength(2);
    const forward = slip.hops[1];
    expect(forward?.to).toContain('division-legal');
    expect(forward?.copiedTo).toEqual(['division-finance', 'division-planning']);
    expect(slip.hops[0]?.copiedTo).toEqual([]);
    // Nobody has accepted the forward yet, so RECEIVED is blank — as it is on the paper form.
    expect(forward?.receivedAt).toBeNull();
  });

  it('renders a PDF for a document with no hops at all', async () => {
    const cookie = await asRecords();
    const document = await register(cookie);

    const documents = app.get(DocumentsService);
    const exports = app.get(ReportExportService);
    const actor = await recordsOfficer();

    const slip = await documents.routingSlip(actor, document.id);
    const pdf = await exports.routingSlip(slip);

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1000);
  });
});
