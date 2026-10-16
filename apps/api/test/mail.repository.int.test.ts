import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/client.js';
import {
  divisions,
  documentReferences,
  documents,
  fileRecords,
  fileVersions,
  users,
} from '../src/database/schema.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import type { ConfigService } from '@nestjs/config';
import { DrizzleAuditWriter } from '../src/modules/audit/audit.writer.js';
import { DrizzleOutboxWriter } from '../src/modules/audit/outbox.writer.js';
import { FileVersionsRepository } from '../src/modules/files/file-versions.repository.js';
import { MailRepository, type NewMailMessage } from '../src/modules/mail/mail.repository.js';
import { MailService } from '../src/modules/mail/mail.service.js';

/**
 * The two Postgres-only properties the release-mail repositories rely on: the partial unique index
 * that keeps one `DRAFT` per document (what makes drafting idempotent under `ON CONFLICT DO
 * NOTHING`), and the unscoped requester-email read through `document_references`.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for destructive integration tests');

const { pool, db } = createDatabase(databaseUrl, { poolMax: 3 });
const mail = new MailRepository(db);
const documentsRepository = new DocumentsRepository(db);
const mailService = new MailService(
  db,
  mail,
  documentsRepository,
  new FileVersionsRepository(db),
  new DrizzleAuditWriter(db),
  new DrizzleOutboxWriter(db),
  { get: () => undefined } as unknown as ConfigService,
);

const ids = {
  division: randomUUID(),
  user: randomUUID(),
  outgoing: randomUUID(),
  request: randomUUID(),
  silentRequest: randomUUID(),
  signedInTx: randomUUID(),
  version: randomUUID(),
};

const draftFor = (documentId: string, subject: string): NewMailMessage => ({
  documentId,
  fileVersionId: ids.version,
  toAddresses: ['clerk@agency.gov'],
  ccAddresses: [],
  bccAddresses: [],
  subject,
  body: 'Body',
  createdById: ids.user,
});

beforeAll(async () => {
  await pool.query(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
  );
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

  await db.insert(divisions).values({ id: ids.division, code: 'MAILT', name: 'Mail test' });
  await db.insert(users).values({
    id: ids.user,
    email: 'mail-int@dts.local',
    displayName: 'Mail Int',
    passwordHash: 'x',
    role: 'RECORDS_STAFF',
    divisionId: ids.division,
  });
  const document = (id: string, tracking: string, direction: 'INCOMING' | 'OUTGOING') => ({
    id,
    trackingNumber: tracking,
    title: tracking,
    type: 'LETTER',
    priority: 'NORMAL' as const,
    direction,
    divisionId: ids.division,
    createdById: ids.user,
  });
  await db
    .insert(documents)
    .values([
      document(ids.outgoing, 'MAIL-OUT-1', 'OUTGOING'),
      { ...document(ids.request, 'MAIL-IN-1', 'INCOMING'), email: 'citizen@mail.com' },
      document(ids.silentRequest, 'MAIL-IN-2', 'INCOMING'),
      document(ids.signedInTx, 'MAIL-OUT-2', 'OUTGOING'),
    ]);
  // Two statements, so the links get distinct `created_at` values and a defined read order.
  for (const incomingDocumentId of [ids.request, ids.silentRequest])
    await db
      .insert(documentReferences)
      .values({ outgoingDocumentId: ids.outgoing, incomingDocumentId, createdById: ids.user });
  const [record] = await db
    .insert(fileRecords)
    .values({ documentId: ids.outgoing, displayName: 'Letter', createdById: ids.user })
    .returning();
  await db.insert(fileVersions).values({
    id: ids.version,
    fileRecordId: record!.id,
    versionNumber: 1,
    objectKey: `documents/${ids.outgoing}/${ids.version}`,
    originalName: 'signed.pdf',
    mediaType: 'application/pdf',
    sizeBytes: 1,
    checksumSha256: 'a'.repeat(64),
    uploaderId: ids.user,
  });
});

afterAll(async () => {
  await pool.end();
});

describe('mail repository against Postgres', () => {
  it('keeps one DRAFT per document: a second insert is a no-op that returns null', async () => {
    const first = await mail.insertDraft(draftFor(ids.outgoing, 'First'));
    expect(first).not.toBeNull();

    const second = await mail.insertDraft(draftFor(ids.outgoing, 'Second'));
    expect(second).toBeNull();

    const rows = await mail.listForDocument(ids.outgoing);
    expect(rows.map((row) => [row.subject, row.status])).toEqual([['First', 'DRAFT']]);
    expect((await mail.findDraft(ids.outgoing))?.id).toBe(first?.id);
  });

  it('allows a new draft once the old one has left DRAFT, and any number of queued rows', async () => {
    const draft = await mail.findDraft(ids.outgoing);
    // Never edited, so `updated_at` is still the insert's microsecond `now()`.
    expect(await mail.markQueued(draft!.id, ids.user, draft!.updatedAt)).toMatchObject({
      status: 'QUEUED',
    });
    await mail.insertQueued({ ...draftFor(ids.outgoing, 'Resend'), sentById: ids.user });

    const next = await mail.insertDraft(draftFor(ids.outgoing, 'Next draft'));
    expect(next?.status).toBe('DRAFT');
    expect(await mail.listForDocument(ids.outgoing)).toHaveLength(3);
  });

  it('reads the release state in one query and skips only the newest unsent message, once', async () => {
    expect(await mail.releaseState(ids.request)).toEqual({
      exists: false,
      sent: false,
      skipped: false,
    });
    expect(await mail.releaseState(ids.outgoing)).toEqual({
      exists: true,
      sent: false,
      skipped: false,
    });

    const resend = (await mail.listForDocument(ids.outgoing)).find(
      (row) => row.subject === 'Resend',
    );
    await mail.markSent(resend!.id, '<sent@test>');
    expect((await mail.releaseState(ids.outgoing)).sent).toBe(true);

    const latest = await mail.findLatestUnsent(ids.outgoing);
    expect(latest?.subject).toBe('Next draft');
    expect(await mail.markSkipped(resend!.id, 'Sent already')).toBeNull();

    const skipped = await mail.markSkipped(latest!.id, 'Hand-delivered');
    expect(skipped?.skipRemarks).toBe('Hand-delivered');
    // A second skip of the same row never overwrites the first remark.
    expect(await mail.markSkipped(latest!.id, 'Another reason')).toBeNull();
    expect((await mail.findDraft(ids.outgoing))?.skipRemarks).toBe('Hand-delivered');
    expect(await mail.releaseState(ids.outgoing)).toEqual({
      exists: true,
      sent: true,
      skipped: true,
    });
  });

  it('queues a draft only while it is unskipped and unchanged since it was read', async () => {
    const draft = (await mail.insertDraft(draftFor(ids.silentRequest, 'Concurrent')))!;
    const patch = {
      toAddresses: ['clerk@agency.gov'],
      ccAddresses: [],
      bccAddresses: [],
      subject: 'Edited',
      body: 'Body',
    };
    // Past the insert's millisecond, which is the precision the check compares at.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const edited = (await mail.updateDraft(draft.id, patch))!;
    // The read before the edit is stale: the edit wins and nothing is queued.
    expect(await mail.markQueued(draft.id, ids.user, draft.updatedAt)).toBeNull();

    expect(await mail.markSkipped(draft.id, 'Hand-delivered')).not.toBeNull();
    const skipped = (await mail.findDraft(ids.silentRequest))!;
    // A skipped draft is locked: neither an edit nor a send, even with a fresh read.
    expect(await mail.updateDraft(draft.id, { ...patch, subject: 'Stale dialog' })).toBeNull();
    expect(await mail.markQueued(draft.id, ids.user, skipped.updatedAt)).toBeNull();
    expect(skipped).toMatchObject({ status: 'DRAFT', subject: edited.subject });
  });

  it('reads the linked requesters’ emails, nulls included', async () => {
    expect(await documentsRepository.listLinkedRequesterEmails(ids.outgoing)).toEqual([
      'citizen@mail.com',
      null,
    ]);
  });

  it('drafts from a signature written in the same, still-open transaction', async () => {
    // The pool cannot see an uncommitted row, so this passes only if every read `createDraft`
    // makes goes through the transaction handle it was given.
    const draft = await db.transaction(async (tx) => {
      await documentsRepository.insertSignatureEvent(
        { documentId: ids.signedInTx, fileVersionId: ids.version, signerId: ids.user },
        tx,
      );
      expect(await documentsRepository.listSignatures(ids.signedInTx)).toEqual([]);
      return mailService.createDraft(ids.signedInTx, ids.user, tx);
    });

    expect(draft).toMatchObject({
      documentId: ids.signedInTx,
      status: 'DRAFT',
      attachmentName: 'signed.pdf',
    });
  });
});
