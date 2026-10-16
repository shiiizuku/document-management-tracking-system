import { Injectable } from '@nestjs/common';

export type OutgoingMail = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  attachment: { filename: string; content: Uint8Array; contentType: string };
};

/**
 * What the server answered. `rejected` lists the recipients it refused while accepting the
 * others: SMTP takes a message once any recipient is accepted, so a resolved send is not
 * proof that everyone got it.
 */
export type SentMail = { messageId: string; rejected: string[] };

/** Boundary to whatever delivers outgoing mail; SMTP is the production binding. */
@Injectable()
export abstract class MailSender {
  abstract send(message: OutgoingMail): Promise<SentMail>;
}
