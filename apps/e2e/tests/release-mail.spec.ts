import { truncateDocuments } from '../fixtures/database';
import { clearMailpit, waitForMail } from '../fixtures/mailpit';
import {
  openDocumentFromRegistry,
  registerDocument,
  runAction,
  uploadAttachment,
  waitForScanClean,
} from '../fixtures/screens';
import { expect, test } from '../fixtures/test';

/**
 * Release by email: the Compose dialog opens with the addresses the system found, Send hands the
 * signed PDF to the worker, the worker delivers it over SMTP, and only then can the document be
 * released as Emailed.
 *
 * Needs Mailpit (`docker compose up -d --wait mailpit`); see the README. The worker is pointed at
 * it by `serverEnvironment()`, so a message lands in Mailpit only if the real send path ran.
 */

const INCOMING_TITLE = 'Request for a copy of the approved survey plan';
const OUTGOING_TITLE = 'Reply with the approved survey plan';
const REQUESTER_EMAIL = 'requester@example.test';
const RECIPIENT_EMAIL = 'finance.records@example.test';
const SIGNED_FILE = 'signed-survey-plan.pdf';

test.beforeAll(async () => {
  await truncateDocuments();
  await clearMailpit();
});

test('a signed letter is emailed to its recipient and the requester, then released as Emailed', async ({
  actingAs,
}) => {
  const head = await actingAs('head');

  await test.step('the request arrives with a contact email', async () => {
    await registerDocument(head, {
      title: INCOMING_TITLE,
      direction: 'Incoming',
      type: 'Letter',
      division: 'Pilot Division',
      sender: 'Provincial Assessor, Benguet',
      email: REQUESTER_EMAIL,
    });
  });

  await test.step('the reply is drafted, linked to it, endorsed and submitted', async () => {
    await registerDocument(head, {
      title: OUTGOING_TITLE,
      direction: 'Outgoing',
      type: 'Letter',
      division: 'Pilot Division',
      recipientEmail: RECIPIENT_EMAIL,
    });
    await runAction(head, 'Accept custody', 'In process');
    await uploadAttachment(head, SIGNED_FILE);
    await waitForScanClean(head);

    await head.getByRole('button', { name: 'Add reference' }).click();
    await head.getByPlaceholder('Search incoming documents').fill(INCOMING_TITLE);
    await head.getByRole('option', { name: new RegExp(INCOMING_TITLE) }).click();
    await expect(head.getByRole('button', { name: /Remove the reference to/ })).toBeVisible();

    await runAction(head, 'Record initial', 'For initial');
    await runAction(head, 'Submit for signature', 'For signature');
  });

  await test.step('the Director signs', async () => {
    const director = await actingAs('director');
    await openDocumentFromRegistry(director, OUTGOING_TITLE);
    await runAction(director, 'Record signature', 'Signed');
  });

  const records = await actingAs('records');

  await test.step('preparing the release drafts the email to both addresses', async () => {
    await openDocumentFromRegistry(records, OUTGOING_TITLE);
    await runAction(records, 'Prepare release', 'For release');

    const section = records.getByRole('region', { name: 'Release email' });
    await expect(section.getByText('Draft', { exact: true })).toBeVisible();
    await section.getByRole('button', { name: 'Compose' }).click();

    const dialog = records.getByRole('dialog', { name: 'Release email' });
    await expect(dialog.getByText(RECIPIENT_EMAIL)).toBeVisible();
    await expect(dialog.getByText(REQUESTER_EMAIL)).toBeVisible();
    await expect(dialog.getByText(SIGNED_FILE)).toBeVisible();
  });

  await test.step('Send delivers one message with the signed PDF attached', async () => {
    await records.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(records.getByRole('dialog')).toBeHidden();

    const [message, ...others] = await waitForMail(1);
    expect(others).toHaveLength(0);
    expect(message?.to.toSorted()).toEqual([RECIPIENT_EMAIL, REQUESTER_EMAIL].toSorted());
    expect(message?.subject).toContain(OUTGOING_TITLE);
    expect(message?.attachments).toEqual([
      { fileName: SIGNED_FILE, contentType: 'application/pdf' },
    ]);
  });

  await test.step('the sent mail unlocks release by Emailed', async () => {
    // The section polls while the message is queued, so the result arrives without a reload.
    const section = records.getByRole('region', { name: 'Release email' });
    await expect(section.getByText('The mail was sent.')).toBeVisible();

    await runAction(records, 'Release document', 'Released', { method: 'Emailed' });
    await expect(records.getByText('Released by')).toBeVisible();
    await expect(records.getByText('Emailed', { exact: true })).toBeVisible();
  });
});
