import { randomUUID } from 'node:crypto';
import type { MailStatus } from '@dts/contracts';
import type {
  MailDraftPatch,
  MailMessageRow,
  NewMailMessage,
} from '../src/modules/mail/mail.repository.js';

/**
 * Stand-in for {@link MailRepository} in the full-app REST suites. It keeps the one rule the
 * database enforces with a partial unique index — at most one `DRAFT` per document — so a repeat
 * `insertDraft` returns `null` here exactly as `ON CONFLICT DO NOTHING` does in Postgres.
 */
export class InMemoryMailRepository {
  private readonly rows: MailMessageRow[] = [];
  // Strictly increasing so `listForDocument` orders deterministically within one millisecond.
  private clock = Date.now();

  private row(values: NewMailMessage, status: MailStatus, sentById: string | null): MailMessageRow {
    const timestamp = new Date(++this.clock);
    return {
      id: randomUUID(),
      ...values,
      status,
      attempts: 0,
      lastError: null,
      smtpMessageId: null,
      sentAt: null,
      skippedAt: null,
      skipRemarks: null,
      sentById,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  private copy(row: MailMessageRow): MailMessageRow {
    return {
      ...row,
      toAddresses: [...row.toAddresses],
      ccAddresses: [...row.ccAddresses],
      bccAddresses: [...row.bccAddresses],
    };
  }

  insertDraft(values: NewMailMessage): Promise<MailMessageRow | null> {
    if (this.rows.some((row) => row.documentId === values.documentId && row.status === 'DRAFT'))
      return Promise.resolve(null);
    const row = this.row(values, 'DRAFT', null);
    this.rows.push(row);
    return Promise.resolve(this.copy(row));
  }

  insertQueued(values: NewMailMessage & { sentById: string }): Promise<MailMessageRow> {
    const { sentById, ...rest } = values;
    const row = this.row(rest, 'QUEUED', sentById);
    this.rows.push(row);
    return Promise.resolve(this.copy(row));
  }

  findDraft(documentId: string): Promise<MailMessageRow | null> {
    const row = this.rows.find((r) => r.documentId === documentId && r.status === 'DRAFT');
    return Promise.resolve(row ? this.copy(row) : null);
  }

  findForDocument(documentId: string, mailId: string): Promise<MailMessageRow | null> {
    const row = this.rows.find((r) => r.id === mailId && r.documentId === documentId);
    return Promise.resolve(row ? this.copy(row) : null);
  }

  listForDocument(documentId: string): Promise<MailMessageRow[]> {
    return Promise.resolve(
      this.rows.filter((row) => row.documentId === documentId).map((row) => this.copy(row)),
    );
  }

  updateDraft(mailId: string, patch: MailDraftPatch): Promise<MailMessageRow | null> {
    return this.mutateDraft((row) => row.id === mailId, patch);
  }

  markQueued(mailId: string, sentById: string): Promise<MailMessageRow | null> {
    return this.mutateDraft((row) => row.id === mailId, { status: 'QUEUED', sentById });
  }

  markSkipped(documentId: string, remarks: string): Promise<MailMessageRow | null> {
    return this.mutateDraft((row) => row.documentId === documentId, {
      skippedAt: new Date(),
      skipRemarks: remarks,
    });
  }

  hasStatus(documentId: string, status: MailStatus): Promise<boolean> {
    return Promise.resolve(
      this.rows.some((row) => row.documentId === documentId && row.status === status),
    );
  }

  hasSkipped(documentId: string): Promise<boolean> {
    return Promise.resolve(
      this.rows.some((row) => row.documentId === documentId && row.skippedAt !== null),
    );
  }

  /** Stands in for the worker, which owns the QUEUED → SENT/FAILED transition. */
  setStatusForTest(mailId: string, status: MailStatus): void {
    const row = this.rows.find((r) => r.id === mailId);
    if (row === undefined) throw new Error(`no mail message ${mailId}`);
    row.status = status;
    if (status === 'SENT') row.sentAt = new Date();
  }

  private mutateDraft(
    match: (row: MailMessageRow) => boolean,
    patch: Partial<MailMessageRow>,
  ): Promise<MailMessageRow | null> {
    const row = this.rows.find((r) => r.status === 'DRAFT' && match(r));
    if (row === undefined) return Promise.resolve(null);
    Object.assign(row, patch, { updatedAt: new Date() });
    return Promise.resolve(this.copy(row));
  }
}
