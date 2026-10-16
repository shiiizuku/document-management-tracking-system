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
 */
export interface MailDeliveryDeps {
  mail: {
    findById(mailId: string): Promise<MailMessageRow | null>;
    recordAttempt(mailId: string, attempts: number, lastError: string): Promise<void>;
    markSent(mailId: string, smtpMessageId: string): Promise<MailMessageRow | null>;
    markFailed(mailId: string, attempts: number, lastError: string): Promise<MailMessageRow | null>;
  };
  versions: { findVersionById(versionId: string): Promise<FileVersionRow | null> };
  storage: { get(key: string): Promise<Uint8Array | null> };
  sender: MailSender | null;
  from: string;
  audit?: {
    write(entry: {
      actorId: string | null;
      action: string;
      targetType: string;
      targetId: string;
      outcome: 'SUCCESS' | 'FAILURE';
      summary?: Record<string, unknown>;
    }): Promise<void>;
  };
  logger?: { log(message: string): void; warn(message: string): void };
}

const LAST_ERROR_LIMIT = 500;

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const recipientCount = (message: MailMessageRow): number =>
  message.toAddresses.length + message.ccAddresses.length + message.bccAddresses.length;

/**
 * Delivers one queued message. Idempotent: only a `QUEUED` message is sent, so a redelivered job
 * for one already `SENT` or `FAILED` returns quietly. A problem retrying cannot fix (attachment
 * not clean, bytes or version missing, mail unconfigured) fails the message at once and does not
 * throw. Anything else that throws — the transport, or a database read — records the attempt and
 * throws so BullMQ retries with backoff; on the final attempt it records `FAILED` and does not
 * throw, so no message is left `QUEUED` for good. Logs and audit rows carry ids and a recipient
 * count, never addresses or the body.
 */
export const deliverMail = async (
  deps: MailDeliveryDeps,
  mailId: string,
  attempt: MailAttempt,
): Promise<void> => {
  const fail = async (reason: string): Promise<void> => {
    const failed = await deps.mail.markFailed(
      mailId,
      attempt.made,
      reason.slice(0, LAST_ERROR_LIMIT),
    );
    if (failed === null) return;
    await deps.audit?.write({
      actorId: null,
      action: 'mail.failed',
      targetType: 'document',
      targetId: failed.documentId,
      outcome: 'FAILURE',
      summary: { mailId, attempts: attempt.made, recipients: recipientCount(failed) },
    });
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
    if (version.scanStatus !== 'CLEAN') return await fail('Attachment has not been scanned clean');

    const bytes = await deps.storage.get(version.objectKey);
    if (bytes === null) return await fail('Attachment bytes are missing from storage');

    const { messageId } = await deps.sender.send({
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
     * At-least-once window: SMTP has accepted the message, but if `markSent` throws here the row
     * stays `QUEUED` and the retry sends it again, so the recipients get it twice. Accepted: a
     * duplicate email is better than a release email recorded as lost.
     */
    const sent = await deps.mail.markSent(mailId, messageId);
    if (sent === null) return;
    await deps.audit?.write({
      actorId: message.sentById,
      action: 'mail.sent',
      targetType: 'document',
      targetId: message.documentId,
      outcome: 'SUCCESS',
      summary: { mailId, recipients: recipientCount(message) },
    });
    deps.logger?.log(`mail ${mailId} sent`);
  } catch (error) {
    const reason = describeError(error);
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
