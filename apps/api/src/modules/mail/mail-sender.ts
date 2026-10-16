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

/** Boundary to whatever delivers outgoing mail; SMTP is the production binding. */
@Injectable()
export abstract class MailSender {
  abstract send(message: OutgoingMail): Promise<{ messageId: string }>;
}
