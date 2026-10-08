import { truncateDocuments } from '../fixtures/database';
import {
  action,
  actions,
  attachments,
  openDocumentFromRegistry,
  rail,
  registerDocument,
  runAction,
  status,
  uploadAttachment,
  waitForScanClean,
} from '../fixtures/screens';
import { expect, test } from '../fixtures/test';

/**
 * Scenario 2 of `docs/acceptance-scenarios.md`: an outgoing letter from draft to release, and the
 * ORD variant that skips the division head's initial.
 *
 * Three principals, and the order they act in is the substance of the scenario: the Pilot Division
 * head drafts and endorses, the **Regional Director signs and does nothing else** (ADR-0006), and
 * the Records Officer prepares, releases and archives. One hop for the Director is the thing
 * fixtures get wrong, so it is asserted directly: the rail offers that account exactly one button.
 */

const TITLE = 'Reply to request for certified true copy';
const ORD_TITLE = 'Transmittal of certified true copy';
const YEAR = new Date().getUTCFullYear();

test.beforeAll(async () => {
  await truncateDocuments();
});

test('an outgoing letter is drafted, endorsed, signed, released by courier and archived', async ({
  actingAs,
}) => {
  const head = await actingAs('head');

  await test.step('2.1 registration allocates the office’s own reference', async () => {
    /*
     * Registered at division level, with no section. A division head sits in no section and a hop
     * addressed to one can only be accepted from inside it, so registering into General Section
     * would produce a draft its own author could not accept.
     */
    await registerDocument(head, {
      title: TITLE,
      direction: 'Outgoing',
      type: 'Letter',
      division: 'Pilot Division',
    });

    await expect(head.getByText(`DTS-${YEAR}-000001`)).toBeVisible();
    // Decision 169: an outgoing document is stamped with an office reference allocated per division
    // and year, inside the same transaction as the tracking number. The division code in it is
    // permanent, which is why a division is deactivated and never deleted (decision 153).
    await expect(head.getByText(`PILOT-${YEAR}-00001`)).toBeVisible();
    await expect(status(head)).toHaveText('Pending');
  });

  await test.step('2.2 the draft is taken on and its file uploaded', async () => {
    await runAction(head, 'Accept custody', 'In process');
    await uploadAttachment(head, 'reply-draft.pdf');
    await waitForScanClean(head);
  });

  await test.step('2.3 the division head’s initial, then submission', async () => {
    /*
     * Two acts by two authorities (ADR-0006). `DOCUMENT_INITIAL` is held by `DIVISION_HEAD` and by
     * nobody else — not even the Director, who would otherwise be endorsing a draft they are about
     * to sign, which is exactly what splitting the two was for.
     */
    await runAction(head, 'Record initial', 'For initial');
    await runAction(head, 'Submit for signature', 'For signature');
  });

  await test.step('2.4 the Director signs, and does only that', async () => {
    const director = await actingAs('director');
    await openDocumentFromRegistry(director, TITLE);

    // The narrowest non-viewer role in the table: `DOCUMENT_SIGN` and `REPORT_VIEW`, nothing else.
    // Counting the buttons is the assertion — naming the absent ones would pass against a bar
    // that had grown a new one.
    await expect(actions(director)).toHaveCount(1);
    await runAction(director, 'Record signature', 'Signed');

    // And now there is nothing further this account may do to it.
    await expect(actions(director)).toHaveCount(0);
    await expect(rail(director)).toContainText('No workflow actions are available to you');
  });

  await test.step('2.5 release requires a consignment number, and records it', async () => {
    const records = await actingAs('records');
    await openDocumentFromRegistry(records, TITLE);

    await runAction(records, 'Prepare release', 'For release');

    /*
     * Two questions, not one (policy register P-15 as decided 2026-10-06): how the document left,
     * and for Mailed, by which carrier. Every carrier requires a tracking reference, a property
     * of the carrier row rather than of the action, and the server refuses one against a method
     * that takes no carrier.
     */
    await runAction(records, 'Release document', 'Released', {
      method: 'Mailed',
      carrier: 'LBC',
      trackingReference: 'LBC-2026-884411',
    });

    await expect(records.getByText('Released by')).toBeVisible();
    await expect(records.getByText('Mailed', { exact: true })).toBeVisible();
    await expect(records.getByText('LBC-2026-884411')).toBeVisible();

    await runAction(records, 'Archive', 'Archived');
  });
});

/**
 * ADR-0007, and the reason migration `0009` placed the records officer inside the ORD: an outgoing
 * draft the ORD owns goes straight to signature.
 *
 * Its own test rather than a step of the one above, because it is a second document registered by
 * a different account and the thing being asserted is an absence — `Record initial` is not offered
 * — which reads better as a claim of its own than as a coda.
 */
test('an outgoing letter drafted in the ORD skips the division head’s initial', async ({
  actingAs,
}) => {
  const records = await actingAs('records');

  await registerDocument(records, {
    title: ORD_TITLE,
    direction: 'Outgoing',
    type: 'Letter',
    division: 'Office of the Regional Director',
    section: 'Records Unit',
  });

  // A counter per division and year, so the ORD's first outgoing reference is its own `00001`
  // regardless of what the Pilot Division has issued.
  await expect(records.getByText(`ORD-${YEAR}-00001`)).toBeVisible();

  await runAction(records, 'Accept custody', 'In process');
  await uploadAttachment(records, 'transmittal.pdf');
  await waitForScanClean(records);

  /*
   * The ORD is itself a division that registers outgoing correspondence, and its head *is* the
   * Director — so requiring an initial here would have one person perform both acts. The exemption
   * reads off the division's code, which is why it survived migration `0009` untouched.
   */
  await expect(action(records, 'Record initial')).toHaveCount(0);
  await runAction(records, 'Submit for signature', 'For signature');

  // And the file that will be signed is the one that was scanned clean, not merely the latest.
  await expect(attachments(records).getByText('Clean', { exact: true })).toBeVisible();
});
