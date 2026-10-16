import nodemailer, { type Transporter } from 'nodemailer';
import { MailSender, type OutgoingMail, type SentMail } from './mail-sender.js';

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user?: string | undefined;
  pass?: string | undefined;
  from: string;
};

/** Nodemailer-backed sender. Credentials live only in the transport; nothing here logs them. */
export class SmtpMailSender extends MailSender {
  private readonly transport: Transporter;

  constructor(config: SmtpConfig, transport?: Transporter) {
    super();
    this.transport =
      transport ??
      nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        ...(config.user ? { auth: { user: config.user, pass: config.pass ?? '' } } : {}),
      });
  }

  async send(message: OutgoingMail): Promise<SentMail> {
    const info = (await this.transport.sendMail({
      from: message.from,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      subject: message.subject,
      text: message.text,
      attachments: [
        {
          filename: message.attachment.filename,
          content: Buffer.from(message.attachment.content),
          contentType: message.attachment.contentType,
        },
      ],
    })) as { messageId: string; rejected?: (string | { address: string })[] };
    // Nodemailer resolves once any recipient is accepted and lists the refused ones here.
    const rejected = (info.rejected ?? []).map((entry) =>
      typeof entry === 'string' ? entry : entry.address,
    );
    return { messageId: info.messageId, rejected };
  }
}
