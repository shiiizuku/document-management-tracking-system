import { MailSender, type OutgoingMail, type SentMail } from '../src/modules/mail/mail-sender.js';

export class InMemoryMailSender extends MailSender {
  readonly sent: OutgoingMail[] = [];
  failWith: Error | null = null;
  /** Addresses the "server" refuses while accepting the rest, as SMTP may. */
  rejectAddresses: string[] = [];

  send(message: OutgoingMail): Promise<SentMail> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    const rejected = [...message.to, ...message.cc, ...message.bcc].filter((address) =>
      this.rejectAddresses.includes(address),
    );
    return Promise.resolve({ messageId: `<mem-${this.sent.length}@test>`, rejected });
  }
}
