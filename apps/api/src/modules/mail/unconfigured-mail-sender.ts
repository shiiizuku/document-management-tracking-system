import { MailSender } from './mail-sender.js';

/**
 * The binding when `SMTP_HOST` is unset. `MailService` refuses Send before anything is queued, so
 * reaching this is a message queued while mail was configured and delivered after it was not; the
 * worker records the refusal as the delivery error.
 */
export class UnconfiguredMailSender extends MailSender {
  send(): Promise<{ messageId: string }> {
    return Promise.reject(new Error('Outgoing mail is not configured (SMTP_HOST is unset)'));
  }
}
