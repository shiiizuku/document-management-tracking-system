import { MailSender, type OutgoingMail } from '../src/modules/mail/mail-sender.js';

export class InMemoryMailSender extends MailSender {
  readonly sent: OutgoingMail[] = [];
  failWith: Error | null = null;

  send(message: OutgoingMail): Promise<{ messageId: string }> {
    if (this.failWith) return Promise.reject(this.failWith);
    this.sent.push(message);
    return Promise.resolve({ messageId: `<mem-${this.sent.length}@test>` });
  }
}
