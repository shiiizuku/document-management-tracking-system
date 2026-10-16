import nodemailer, { type Transporter } from 'nodemailer';
import { describe, expect, it } from 'vitest';
import type { OutgoingMail } from '../src/modules/mail/mail-sender.js';
import { SmtpMailSender } from '../src/modules/mail/smtp-mail-sender.js';

const mail: OutgoingMail = {
  from: 'dts@example.ph',
  to: ['a@y.ph'],
  cc: ['c@y.ph'],
  bcc: ['b@y.ph'],
  subject: 'Release: DOC-1',
  text: 'Attached.',
  attachment: {
    filename: 'DOC-1.pdf',
    content: new Uint8Array([1, 2, 3]),
    contentType: 'application/pdf',
  },
};

describe('SmtpMailSender', () => {
  it('renders every field of the message and returns the transport message id', async () => {
    const json = nodemailer.createTransport({ jsonTransport: true });
    let info!: { messageId: string; message: string };
    const transport = {
      sendMail: async (m: Parameters<Transporter['sendMail']>[0]) => {
        info = await json.sendMail(m);
        return info;
      },
    } as unknown as Transporter;
    const sender = new SmtpMailSender(
      { host: 'localhost', port: 25, secure: false, from: 'dts@example.ph' },
      transport,
    );

    const result = await sender.send(mail);
    const rendered = JSON.parse(info.message) as {
      from: { address: string };
      to: { address: string }[];
      cc: { address: string }[];
      bcc: { address: string }[];
      subject: string;
      text: string;
      attachments: { filename: string }[];
    };

    expect(result.messageId).toBe(info.messageId);
    expect(result.messageId).toBeTruthy();
    expect(rendered.from.address).toBe('dts@example.ph');
    expect(rendered.to.map((a) => a.address)).toEqual(['a@y.ph']);
    expect(rendered.cc.map((a) => a.address)).toEqual(['c@y.ph']);
    expect(rendered.bcc.map((a) => a.address)).toEqual(['b@y.ph']);
    expect(rendered.subject).toBe('Release: DOC-1');
    expect(rendered.text).toBe('Attached.');
    expect(rendered.attachments.map((a) => a.filename)).toEqual(['DOC-1.pdf']);
  });

  it.each([
    ['strings', ['a@y.ph']],
    ['addresses', [{ name: 'A', address: 'a@y.ph' }]],
  ])('reports the recipients the server rejected, given as %s', async (_shape, rejected) => {
    const transport = {
      sendMail: () => Promise.resolve({ messageId: '<m@test>', accepted: ['c@y.ph'], rejected }),
    } as unknown as Transporter;
    const sender = new SmtpMailSender(
      { host: 'localhost', port: 25, secure: false, from: 'dts@example.ph' },
      transport,
    );

    expect(await sender.send(mail)).toEqual({ messageId: '<m@test>', rejected: ['a@y.ph'] });
  });

  it('reports no rejected recipients when the transport lists none', async () => {
    const transport = {
      sendMail: () => Promise.resolve({ messageId: '<m@test>' }),
    } as unknown as Transporter;
    const sender = new SmtpMailSender(
      { host: 'localhost', port: 25, secure: false, from: 'dts@example.ph' },
      transport,
    );

    expect((await sender.send(mail)).rejected).toEqual([]);
  });
});
