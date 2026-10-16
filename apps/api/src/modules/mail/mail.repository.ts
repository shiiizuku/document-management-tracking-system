import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
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

/** What the Emailed release rule and Skip mail read: does any message exist, sent, or skipped. */
export interface MailReleaseState {
  exists: boolean;
  sent: boolean;
  skipped: boolean;
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

  /**
   * The document's newest message that has not been sent — a draft, a queued one or a failed one:
   * what Skip mail marks. `null` when every message is sent, or there is none.
   */
  async findLatestUnsent(
    documentId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow | null> {
    const [row] = await executor
      .select()
      .from(mailMessages)
      .where(and(eq(mailMessages.documentId, documentId), ne(mailMessages.status, 'SENT')))
      .orderBy(desc(mailMessages.createdAt), desc(mailMessages.id))
      .limit(1);
    return row ?? null;
  }

  /**
   * Marks one unsent message as deliberately not sent. `null` when it was sent or skipped in the
   * meantime, so a first remark is never overwritten.
   */
  async markSkipped(
    mailId: string,
    remarks: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailMessageRow | null> {
    const [row] = await executor
      .update(mailMessages)
      .set({ skippedAt: new Date(), skipRemarks: remarks })
      .where(
        and(
          eq(mailMessages.id, mailId),
          ne(mailMessages.status, 'SENT'),
          isNull(mailMessages.skippedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** One message by id, for the worker, which has no document in hand. */
  async findById(mailId: string): Promise<MailMessageRow | null> {
    const [row] = await this.database
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.id, mailId));
    return row ?? null;
  }

  /** A failed delivery attempt that will be retried: the message stays `QUEUED`. */
  async recordAttempt(mailId: string, attempts: number, lastError: string): Promise<void> {
    await this.database
      .update(mailMessages)
      .set({ attempts, lastError })
      .where(and(eq(mailMessages.id, mailId), eq(mailMessages.status, 'QUEUED')));
  }

  /** `QUEUED` to `SENT`; `null` when the message was no longer queued. */
  async markSent(mailId: string, smtpMessageId: string): Promise<MailMessageRow | null> {
    const [row] = await this.database
      .update(mailMessages)
      .set({ status: 'SENT', smtpMessageId, sentAt: new Date() })
      .where(and(eq(mailMessages.id, mailId), eq(mailMessages.status, 'QUEUED')))
      .returning();
    return row ?? null;
  }

  /** `QUEUED` to `FAILED`; `null` when the message was no longer queued. */
  async markFailed(
    mailId: string,
    attempts: number,
    lastError: string,
  ): Promise<MailMessageRow | null> {
    const [row] = await this.database
      .update(mailMessages)
      .set({ status: 'FAILED', attempts, lastError })
      .where(and(eq(mailMessages.id, mailId), eq(mailMessages.status, 'QUEUED')))
      .returning();
    return row ?? null;
  }

  /** One aggregate read: whether the document has any message, a sent one, and a skipped one. */
  async releaseState(
    documentId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<MailReleaseState> {
    const [row] = await executor
      .select({
        exists: sql<boolean>`count(*) > 0`,
        sent: sql<boolean>`coalesce(bool_or(${mailMessages.status} = 'SENT'), false)`,
        skipped: sql<boolean>`coalesce(bool_or(${mailMessages.skippedAt} is not null), false)`,
      })
      .from(mailMessages)
      .where(eq(mailMessages.documentId, documentId));
    return {
      exists: row?.exists === true,
      sent: row?.sent === true,
      skipped: row?.skipped === true,
    };
  }
}
