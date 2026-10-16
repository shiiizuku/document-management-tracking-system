import { expect } from '@playwright/test';
import { MAILPIT_URL } from './environment';

/**
 * Mailpit's HTTP API, for the specs that assert on release mail.
 *
 * Mailpit is the development mail catcher in `docker-compose.yml`; the suite's API and worker are
 * pointed at its SMTP port by `serverEnvironment()`. Nothing here is mocked: a message is in
 * Mailpit only because the worker delivered it over SMTP.
 */

interface MailpitAddress {
  Address: string;
}

interface MailpitSummary {
  ID: string;
  To: MailpitAddress[];
  Subject: string;
  Attachments: number;
}

interface MailpitDetail {
  ID: string;
  To: MailpitAddress[];
  Subject: string;
  Attachments: { FileName: string; ContentType: string; Size: number }[];
}

export interface CaughtMail {
  to: string[];
  subject: string;
  attachments: { fileName: string; contentType: string }[];
}

/** Empties the inbox, so a spec counts only the messages it caused. */
export const clearMailpit = async (): Promise<void> => {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  if (!response.ok)
    throw new Error(
      `Mailpit at ${MAILPIT_URL} answered ${response.status}. Start it with ` +
        '`docker compose up -d --wait mailpit` or set MAILPIT_URL.',
    );
};

const listMessages = async (): Promise<MailpitSummary[]> => {
  const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
  expect(response.ok, `Mailpit list answered ${response.status}`).toBeTruthy();
  return ((await response.json()) as { messages: MailpitSummary[] }).messages;
};

/**
 * Waits for exactly `count` messages and returns them with their attachments.
 *
 * Polled because delivery is the worker's, a queue hop after the Send click. "Exactly" rather than
 * "at least": a retry that double-sent would otherwise pass.
 */
export const waitForMail = async (count: number, timeout = 30_000): Promise<CaughtMail[]> => {
  let summaries: MailpitSummary[] = [];
  await expect(async () => {
    summaries = await listMessages();
    expect(summaries).toHaveLength(count);
  }).toPass({ timeout, intervals: [500] });

  return Promise.all(
    summaries.map(async (summary): Promise<CaughtMail> => {
      const response = await fetch(`${MAILPIT_URL}/api/v1/message/${summary.ID}`);
      expect(response.ok, `Mailpit message answered ${response.status}`).toBeTruthy();
      const detail = (await response.json()) as MailpitDetail;
      return {
        to: detail.To.map((address) => address.Address.toLowerCase()),
        subject: detail.Subject,
        attachments: detail.Attachments.map((attachment) => ({
          fileName: attachment.FileName,
          contentType: attachment.ContentType,
        })),
      };
    }),
  );
};
