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

/**
 * Delivers one queued message. Idempotent: only a `QUEUED` message is sent, so a redelivered job
 * for one already `SENT` or `FAILED` returns quietly. A problem retrying cannot fix (attachment
 * not clean, bytes or version missing, mail unconfigured) fails the message at once and does not
 * throw. A transport failure records the attempt and throws so BullMQ retries with backoff; on the
 * final attempt it records `FAILED` and does not throw. Logs and audit rows carry ids and a
 * recipient count, never addresses or the body.
 */
export const deliverMail = async (
  deps: MailDeliveryDeps,
  mailId: string,
  attempt: MailAttempt,
): Promise<void> => {
  const message = await deps.mail.findById(mailId);
  if (message === null) {
    deps.logger?.warn(`mail ${mailId} not found; skipped`);
    return;
  }
  if (message.status !== 'QUEUED') return;

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
      targetType: 'mail_message',
      targetId: mailId,
      outcome: 'FAILURE',
      summary: { attempts: attempt.made },
    });
    deps.logger?.warn(`mail ${mailId} failed after ${attempt.made} attempt(s)`);
  };

  if (deps.sender === null) return fail('Mail is not configured');

  const version = await deps.versions.findVersionById(message.fileVersionId);
  if (version === null) return fail('Attachment version not found');
  if (version.scanStatus !== 'CLEAN') return fail('Attachment has not been scanned clean');

  try {
    const bytes = await deps.storage.get(version.objectKey);
    if (bytes === null) return fail('Attachment bytes are missing from storage');

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
    const sent = await deps.mail.markSent(mailId, messageId);
    if (sent === null) return;
    await deps.audit?.write({
      actorId: message.sentById,
      action: 'mail.sent',
      targetType: 'mail_message',
      targetId: mailId,
      outcome: 'SUCCESS',
      summary: {
        recipients:
          message.toAddresses.length + message.ccAddresses.length + message.bccAddresses.length,
      },
    });
    deps.logger?.log(`mail ${mailId} sent`);
  } catch (error) {
    const reason = describeError(error);
    if (attempt.made >= attempt.max) return fail(reason);
    await deps.mail.recordAttempt(mailId, attempt.made, reason.slice(0, LAST_ERROR_LIMIT));
    throw error;
  }
};
