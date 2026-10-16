import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { MailStatus } from '@dts/contracts';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { mailMessages } from '../../database/schema.js';

export type MailMessageRow = typeof mailMessages.$inferSelect;

export interface NewMailMessage {
  documentId: string;
  fileVersionId: string;
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string;
  body: string;
  createdById: string;
}

export interface MailDraftPatch {
  toAddresses: string[];
  ccAddresses: string[];
  bccAddresses: string[];
  subject: string;
  body: string;
}

/**
 * `mail_messages`. Every state change is conditional on the status it expects, so a lost race
 * comes back as `null` and the service decides what that means rather than overwriting a row
 * another request already moved on.
 */
@Injectable()
export class MailRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Inserts the document's draft, or returns `null` when it already has one. The partial unique
   * index `mail_messages_one_draft_uq` (`document_id WHERE status = 'DRAFT'`) is the arbiter, so
   * two concurrent prepares cannot both draft.
   */
  async insertDraft(
    values: NewMailMessage,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow | null> {
    const [row] = await executor
      .insert(mailMessages)
      .values({ ...values, status: 'DRAFT' })
      .onConflictDoNothing({
        target: mailMessages.documentId,
        where: sql`${mailMessages.status} = 'DRAFT'`,
      })
      .returning();
    return row ?? null;
  }

  /** A new row already queued for delivery: what a resend writes. */
  async insertQueued(
    values: NewMailMessage & { sentById: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow> {
    const [row] = await executor
      .insert(mailMessages)
      .values({ ...values, status: 'QUEUED' })
      .returning();
    if (row === undefined) throw new Error('mail_messages insert returned no row');
    return row;
  }

  async findDraft(
    documentId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow | null> {
    const [row] = await executor
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.documentId, documentId), eq(mailMessages.status, 'DRAFT')));
    return row ?? null;
  }

  /** One message, only if it belongs to the document named in the path. */
  async findForDocument(documentId: string, mailId: string): Promise<MailMessageRow | null> {
    const [row] = await this.database
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.id, mailId), eq(mailMessages.documentId, documentId)));
    return row ?? null;
  }

  async listForDocument(documentId: string): Promise<MailMessageRow[]> {
    return this.database
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.documentId, documentId))
      .orderBy(asc(mailMessages.createdAt), asc(mailMessages.id));
  }

  async updateDraft(mailId: string, patch: MailDraftPatch): Promise<MailMessageRow | null> {
    const [row] = await this.database
      .update(mailMessages)
      .set(patch)
      .where(and(eq(mailMessages.id, mailId), eq(mailMessages.status, 'DRAFT')))
      .returning();
    return row ?? null;
  }

  async markQueued(
    mailId: string,
    sentById: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow | null> {
    const [row] = await executor
      .update(mailMessages)
      .set({ status: 'QUEUED', sentById })
      .where(and(eq(mailMessages.id, mailId), eq(mailMessages.status, 'DRAFT')))
      .returning();
    return row ?? null;
  }

  /** Marks the document's draft as deliberately not sent. `null` when there is no draft. */
  async markSkipped(
    documentId: string,
    remarks: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow | null> {
    const [row] = await executor
      .update(mailMessages)
      .set({ skippedAt: new Date(), skipRemarks: remarks })
      .where(and(eq(mailMessages.documentId, documentId), eq(mailMessages.status, 'DRAFT')))
      .returning();
    return row ?? null;
  }

  async hasStatus(documentId: string, status: MailStatus): Promise<boolean> {
    const [row] = await this.database
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(and(eq(mailMessages.documentId, documentId), eq(mailMessages.status, status)))
      .limit(1);
    return row !== undefined;
  }

  async hasSkipped(documentId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ id: mailMessages.id })
      .from(mailMessages)
      .where(and(eq(mailMessages.documentId, documentId), isNotNull(mailMessages.skippedAt)))
      .limit(1);
    return row !== undefined;
  }
}
