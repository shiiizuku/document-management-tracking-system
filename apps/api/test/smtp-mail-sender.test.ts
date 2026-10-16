import nodemailer from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';
import { SmtpMailSender } from '../src/modules/mail/smtp-mail-sender.js';

describe('SmtpMailSender', () => {
  it('sends through the transport and returns a message id', async () => {
    const sender = new SmtpMailSender(
      { host: 'localhost', port: 25, secure: false, from: 'dts@example.ph' },
      nodemailer.createTransport({ jsonTransport: true }),
    );
    const result = await sender.send({
      from: 'dts@example.ph',
      to: ['a@y.ph'],
      cc: [],
      bcc: ['b@y.ph'],
      subject: 'Release: DOC-1',
      text: 'Attached.',
      attachment: {
        filename: 'DOC-1.pdf',
        content: new Uint8Array([1, 2, 3]),
        contentType: 'application/pdf',
      },
    });
    expect(result.messageId).toBeTruthy();
  });

  it('carries the subject and attachment filename in the message', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const sender = new SmtpMailSender(
      { host: 'localhost', port: 25, secure: false, from: 'dts@example.ph' },
      transport,
    );
    const spy = vi.spyOn(transport, 'sendMail');
    await sender.send({
      from: 'dts@example.ph',
      to: ['a@y.ph'],
      cc: [],
      bcc: [],
      subject: 'Release: DOC-1',
      text: 'Attached.',
      attachment: {
        filename: 'DOC-1.pdf',
        content: new Uint8Array([1]),
        contentType: 'application/pdf',
      },
    });
    const info = (await spy.mock.results[0]?.value) as { message: string };
    expect(info.message).toContain('DOC-1.pdf');
    expect(info.message).toContain('Release: DOC-1');
  });
});
