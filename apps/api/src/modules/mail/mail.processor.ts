import type { DatabaseExecutor } from '../../database/executor.js';
import type { MailSender } from './mail-sender.js';
import type { MailMessageRow } from './mail.repository.js';
import type { FileVersionRow } from '../files/file-versions.repository.js';

/** What the worker passes in: which try this is, and how many BullMQ will make in all. */
export interface MailAttempt {
  made: number;
  max: number;
}

/**
 * The slice of each collaborator delivery needs, as narrow structural types so the processor is
 * unit-testable with in-memory doubles (the same shape as the scan consumer). `sender` is `null`
 * when the worker has no SMTP host, which fails the message instead of crashing the worker.
 * `transaction` runs its callback in one database transaction (`db.transaction` in the worker),
 * so a delivery state and its audit row commit together or not at all.
 */
export interface MailDeliveryDeps {
  mail: {
    findById(mailId: string): Promise<MailMessageRow | null>;
    recordAttempt(mailId: string, attempts: number, lastError: string): Promise<void>;
    markSent(
      mailId: string,
      smtpMessageId: string,
      executor?: DatabaseExecutor,
    ): Promise<MailMessageRow | null>;
    markFailed(
      mailId: string,
      attempts: number,
      lastError: string,
      executor?: DatabaseExecutor,
    ): Promise<MailMessageRow | null>;
  };
  transaction<T>(work: (executor: DatabaseExecutor) => Promise<T>): Promise<T>;
  versions: { findVersionById(versionId: string): Promise<FileVersionRow | null> };
  storage: { get(key: string): Promise<Uint8Array | null> };
  sender: MailSender | null;
  from: string;
  audit?: {
    write(
      entry: {
        actorId: string | null;
        action: string;
        targetType: string;
        targetId: string;
        outcome: 'SUCCESS' | 'FAILURE';
        summary?: Record<string, unknown>;
      },
      executor?: DatabaseExecutor,
    ): Promise<void>;
  };
  logger?: { log(message: string): void; warn(message: string): void };
}

const LAST_ERROR_LIMIT = 500;

/** The one attachment type release mail sends; the workflow does not guarantee it. */
const PDF_MEDIA_TYPE = 'application/pdf';

/** The reason recorded when SMTP took the message but its `SENT` row could not be committed. */
const DELIVERED_UNRECORDED =
  'The mail server accepted the message, but recording the delivery failed';

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const recipientCount = (message: MailMessageRow): number =>
  message.toAddresses.length + message.ccAddresses.length + message.bccAddresses.length;

/**
 * Delivers one queued message. Idempotent: only a `QUEUED` message is sent, so a redelivered job
 * for one already `SENT` or `FAILED` returns quietly. A problem retrying cannot fix (attachment
 * not clean or not a PDF, bytes or version missing, mail unconfigured, some recipients rejected)
 * fails the message at once and does not throw. Anything else that throws — the transport, or a
 * database read or write — records the attempt and throws so BullMQ retries with backoff; on the
 * final attempt it records `FAILED` and does not throw, so no message is left `QUEUED` while the
 * database can still be written. Each `SENT`/`FAILED` commits in one transaction with its audit
 * row. Logs and audit rows carry ids and counts, never addresses or the body.
 */
export const deliverMail = async (
  deps: MailDeliveryDeps,
  mailId: string,
  attempt: MailAttempt,
): Promise<void> => {
  const fail = async (reason: string, detail: Record<string, unknown> = {}): Promise<void> => {
    const failed = await deps.transaction(async (tx) => {
      const row = await deps.mail.markFailed(
        mailId,
        attempt.made,
        reason.slice(0, LAST_ERROR_LIMIT),
        tx,
      );
      if (row === null) return null;
      await deps.audit?.write(
        {
          actorId: null,
          action: 'mail.failed',
          targetType: 'document',
          targetId: row.documentId,
          outcome: 'FAILURE',
          summary: { mailId, attempts: attempt.made, recipients: recipientCount(row), ...detail },
        },
        tx,
      );
      return row;
    });
    if (failed === null) return;
    deps.logger?.warn(`mail ${mailId} failed after ${attempt.made} attempt(s)`);
  };

  /*
   * What BullMQ and the worker log. The raw reason stays in `last_error` for the releaser; this is
   * scrubbed, because transport errors often quote the rejected recipient address — and so does a
   * failed `recordAttempt`/`markFailed`, whose drizzle error lists the query parameters. A `cause`
   * would be logged with it and carry the address back in, so none is attached.
   */
  const scrubbed = (): Error =>
    new Error(`mail ${mailId} delivery attempt ${attempt.made}/${attempt.max} failed`);

  // Set once SMTP has taken the message, so a failure after it is not reported as undelivered.
  let delivered = false;
  try {
    const message = await deps.mail.findById(mailId);
    if (message === null) {
      deps.logger?.warn(`mail ${mailId} not found; skipped`);
      return;
    }
    if (message.status !== 'QUEUED') return;

    if (deps.sender === null) return await fail('Mail is not configured');

    const version = await deps.versions.findVersionById(message.fileVersionId);
    if (version === null) return await fail('Attachment version not found');
    // `createDraft` drafts only for a PDF, but a resend copies whatever version a row names.
    if (version.mediaType !== PDF_MEDIA_TYPE) return await fail('The signed file is not a PDF');
    if (version.scanStatus !== 'CLEAN') return await fail('Attachment has not been scanned clean');

    const bytes = await deps.storage.get(version.objectKey);
    if (bytes === null) return await fail('Attachment bytes are missing from storage');

    const { messageId, rejected } = await deps.sender.send({
      from: deps.from,
      to: message.toAddresses,
      cc: message.ccAddresses,
      bcc: message.bccAddresses,
      subject: message.subject,
      text: message.body,
      attachment: {
        filename: version.originalName,
        content: bytes,
        contentType: version.mediaType,
      },
    });
    /*
     * SMTP accepts a message once any recipient is accepted. Some refused is a failure, and not
     * one to retry: a retry would mail the accepted recipients again. Counts only, here and in
     * the audit row: the refused addresses are not recorded.
     */
    if (rejected.length > 0)
      return await fail(
        `The mail server rejected ${rejected.length} of ${recipientCount(message)} recipients`,
        { rejected: rejected.length },
      );
    delivered = true;
    /*
     * At-least-once window: SMTP has accepted the message, but if this commit fails the row stays
     * `QUEUED` and the retry sends it again, so the recipients get it twice. Accepted: a duplicate
     * email is better than a release email recorded as lost.
     */
    const sent = await deps.transaction(async (tx) => {
      const row = await deps.mail.markSent(mailId, messageId, tx);
      if (row === null) return null;
      await deps.audit?.write(
        {
          actorId: message.sentById,
          action: 'mail.sent',
          targetType: 'document',
          targetId: message.documentId,
          outcome: 'SUCCESS',
          summary: { mailId, recipients: recipientCount(message) },
        },
        tx,
      );
      return row;
    });
    if (sent === null) return;
    deps.logger?.log(`mail ${mailId} sent`);
  } catch (error) {
    const reason = delivered ? DELIVERED_UNRECORDED : describeError(error);
    try {
      if (attempt.made >= attempt.max) return await fail(reason);
      await deps.mail.recordAttempt(mailId, attempt.made, reason.slice(0, LAST_ERROR_LIMIT));
    } catch {
      // Recording failed too; its error quotes the raw reason, so only the scrubbed one leaves.
      throw scrubbed();
    }
    throw scrubbed();
  }
};
