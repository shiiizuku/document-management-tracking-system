import { describe, expect, it, vi } from 'vitest';
import { deliverMail, type MailDeliveryDeps } from '../src/modules/mail/mail.processor.js';
import type { FileVersionRow } from '../src/modules/files/file-versions.repository.js';
import { InMemoryMailRepository } from './in-memory-mail.repository.js';
import { InMemoryMailSender } from './in-memory-mail-sender.js';

const version = (overrides: Partial<FileVersionRow> = {}): FileVersionRow =>
  ({
    id: 'v1',
    objectKey: 'files/v1',
    originalName: 'signed.pdf',
    mediaType: 'application/pdf',
    scanStatus: 'CLEAN',
    ...overrides,
  }) as FileVersionRow;

const setup = async (
  opts: {
    version?: FileVersionRow | null;
    bytes?: Uint8Array | null;
    configured?: boolean;
  } = {},
) => {
  const mail = new InMemoryMailRepository();
  const queued = await mail.insertQueued({
    documentId: 'd1',
    fileVersionId: 'v1',
    toAddresses: ['a@example.test', 'b@example.test'],
    ccAddresses: ['c@example.test'],
    bccAddresses: [],
    subject: 'Subject',
    body: 'Body',
    createdById: 'u1',
    sentById: 'u1',
  });
  const sender = new InMemoryMailSender();
  const write = vi.fn(() => Promise.resolve());
  const deps: MailDeliveryDeps = {
    mail,
    versions: {
      findVersionById: vi.fn(() =>
        Promise.resolve('version' in opts ? (opts.version ?? null) : version()),
      ),
    },
    storage: {
      get: vi.fn(() =>
        Promise.resolve('bytes' in opts ? (opts.bytes ?? null) : new Uint8Array([1, 2])),
      ),
    },
    sender: opts.configured === false ? null : sender,
    from: 'dts@example.test',
    audit: { write },
  };
  return { deps, mail, sender, write, id: queued.id };
};

const stored = async (mail: InMemoryMailRepository, id: string) =>
  (await mail.findForDocument('d1', id))!;

describe('deliverMail', () => {
  it('sends the PDF, marks SENT with the SMTP id and audits recipient count only', async () => {
    const h = await setup();
    await deliverMail(h.deps, h.id, { made: 1, max: 5 });
    expect(h.sender.sent).toHaveLength(1);
    expect(h.sender.sent[0]).toMatchObject({
      from: 'dts@example.test',
      to: ['a@example.test', 'b@example.test'],
      cc: ['c@example.test'],
      subject: 'Subject',
      text: 'Body',
      attachment: { filename: 'signed.pdf', contentType: 'application/pdf' },
    });
    const row = await stored(h.mail, h.id);
    expect(row.status).toBe('SENT');
    expect(row.smtpMessageId).toBe('<mem-1@test>');
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(h.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mail.sent',
        targetType: 'document',
        targetId: 'd1',
        summary: { mailId: h.id, recipients: 3 },
      }),
    );
  });

  it('records the attempt and rethrows so the queue retries before the last attempt', async () => {
    const h = await setup();
    h.sender.failWith = new Error('smtp down');
    await expect(deliverMail(h.deps, h.id, { made: 2, max: 5 })).rejects.toThrow(
      `mail ${h.id} delivery attempt 2/5 failed`,
    );
    const row = await stored(h.mail, h.id);
    expect(row.status).toBe('QUEUED');
    expect(row.attempts).toBe(2);
    expect(row.lastError).toBe('smtp down');
    expect(h.write).not.toHaveBeenCalled();
  });

  it('throws a scrubbed error and keeps the raw reason only in last_error', async () => {
    const h = await setup();
    const raw = 'Recipient address rejected: a@example.test, c@example.test';
    h.sender.failWith = new Error(raw);
    const thrown = (await deliverMail(h.deps, h.id, { made: 2, max: 5 }).then(
      () => null,
      (error: unknown) => error,
    )) as Error;
    expect(thrown).toBeInstanceOf(Error);
    // A cause would be logged with the error and carry the raw reason back in.
    expect(thrown.cause).toBeUndefined();
    for (const address of ['a@example.test', 'c@example.test']) {
      expect(raw).toContain(address);
      expect(thrown.message).not.toContain(address);
      expect(thrown.stack ?? '').not.toContain(address);
    }
    expect((await stored(h.mail, h.id)).lastError).toBe(raw);

    await expect(deliverMail(h.deps, h.id, { made: 5, max: 5 })).resolves.toBeUndefined();
    expect((await stored(h.mail, h.id)).status).toBe('FAILED');
  });

  it('marks FAILED, audits and does not rethrow on the final attempt', async () => {
    const h = await setup();
    h.sender.failWith = new Error('x'.repeat(900));
    await expect(deliverMail(h.deps, h.id, { made: 5, max: 5 })).resolves.toBeUndefined();
    const row = await stored(h.mail, h.id);
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(5);
    expect(row.lastError).toHaveLength(500);
    expect(h.write).toHaveBeenCalledWith({
      actorId: null,
      action: 'mail.failed',
      targetType: 'document',
      targetId: 'd1',
      outcome: 'FAILURE',
      summary: { mailId: h.id, attempts: 5, recipients: 3 },
    });
  });

  it.each(['message', 'file version'] as const)(
    'retries, then fails, when reading the %s throws',
    async (read) => {
      const h = await setup();
      // The read fails on both attempts; markFailed still works.
      const outage = new Error('connection reset');
      if (read === 'message') vi.spyOn(h.mail, 'findById').mockRejectedValue(outage);
      else vi.spyOn(h.deps.versions, 'findVersionById').mockRejectedValue(outage);

      await expect(deliverMail(h.deps, h.id, { made: 1, max: 2 })).rejects.toThrow(
        `mail ${h.id} delivery attempt 1/2 failed`,
      );
      expect((await stored(h.mail, h.id)).status).toBe('QUEUED');

      await expect(deliverMail(h.deps, h.id, { made: 2, max: 2 })).resolves.toBeUndefined();
      const row = await stored(h.mail, h.id);
      expect(row.status).toBe('FAILED');
      expect(row.lastError).toBe('connection reset');
      expect(h.sender.sent).toHaveLength(0);
    },
  );

  it('throws the scrubbed error when recording the attempt itself fails', async () => {
    const h = await setup();
    h.sender.failWith = new Error('Recipient address rejected: a@example.test');
    // What drizzle does: the failed query's parameters, the raw last_error included, are quoted.
    vi.spyOn(h.mail, 'recordAttempt').mockRejectedValue(
      new Error('Failed query: update ... params: 2,Recipient address rejected: a@example.test'),
    );

    const thrown = (await deliverMail(h.deps, h.id, { made: 2, max: 5 }).then(
      () => null,
      (error: unknown) => error,
    )) as Error;
    expect(thrown.message).toBe(`mail ${h.id} delivery attempt 2/5 failed`);
    expect(thrown.cause).toBeUndefined();
    expect(thrown.stack ?? '').not.toContain('a@example.test');
  });

  it('throws the scrubbed error when recording the final failure itself fails', async () => {
    const h = await setup();
    h.sender.failWith = new Error('Recipient address rejected: a@example.test');
    vi.spyOn(h.mail, 'markFailed').mockRejectedValue(
      new Error('Failed query: update ... params: 5,Recipient address rejected: a@example.test'),
    );

    const thrown = (await deliverMail(h.deps, h.id, { made: 5, max: 5 }).then(
      () => null,
      (error: unknown) => error,
    )) as Error;
    expect(thrown.message).toBe(`mail ${h.id} delivery attempt 5/5 failed`);
    expect(thrown.stack ?? '').not.toContain('a@example.test');
  });

  it.each([
    ['attachment is not clean', { version: version({ scanStatus: 'PENDING' }) }],
    ['attachment is infected', { version: version({ scanStatus: 'INFECTED' }) }],
    ['bytes are missing', { bytes: null }],
    ['file version is missing', { version: null }],
  ])('fails immediately without sending when the %s', async (_name, opts) => {
    const h = await setup(opts);
    await expect(deliverMail(h.deps, h.id, { made: 1, max: 5 })).resolves.toBeUndefined();
    expect(h.sender.sent).toHaveLength(0);
    const row = await stored(h.mail, h.id);
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toBeTruthy();
    expect(h.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'mail.failed',
        targetType: 'document',
        targetId: 'd1',
        summary: { mailId: h.id, attempts: 1, recipients: 3 },
      }),
    );
  });

  it('fails with a clear reason when mail is not configured, without throwing', async () => {
    const h = await setup({ configured: false });
    await expect(deliverMail(h.deps, h.id, { made: 1, max: 5 })).resolves.toBeUndefined();
    const row = await stored(h.mail, h.id);
    expect(row.status).toBe('FAILED');
    expect(row.lastError).toBe('Mail is not configured');
  });

  it.each(['SENT', 'FAILED'] as const)('does nothing for a message already %s', async (status) => {
    const h = await setup();
    h.mail.setStatusForTest(h.id, status);
    await deliverMail(h.deps, h.id, { made: 1, max: 5 });
    expect(h.sender.sent).toHaveLength(0);
    expect(h.write).not.toHaveBeenCalled();
  });

  it('ignores an unknown message', async () => {
    const h = await setup();
    await expect(deliverMail(h.deps, 'nope', { made: 1, max: 5 })).resolves.toBeUndefined();
    expect(h.sender.sent).toHaveLength(0);
  });
});
