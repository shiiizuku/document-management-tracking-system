import { truncateDocuments } from '../fixtures/database';
import {
  action,
  attachments,
  currentlyWith,
  openDocumentFromRegistry,
  registerDocument,
  runAction,
  status,
  timeline,
  uploadAttachment,
  waitForScanClean,
} from '../fixtures/screens';
import { expect, test } from '../fixtures/test';

/**
 * Scenario 1 of `docs/acceptance-scenarios.md`: an incoming letter from arrival to archive.
 *
 * A transcription of that document rather than coverage invented here, which is why the steps are
 * numbered to match its sections. If this spec and the scenario disagree, the scenario is the one
 * that is right — it is what a person performs at sign-off.
 *
 * Three principals, two of whom sign in: the Records Officer registers, scans and forwards; the
 * Pilot Division's staff accepts and records compliance; the Lands Division is copied in for
 * information and is asserted from the forwarding officer's own timeline, because signing in as a
 * sixth principal would exceed the login throttle (see `fixtures/accounts.ts`).
 */

const TITLE = 'Request for certified true copy of survey plan';
const YEAR = new Date().getUTCFullYear();

test.beforeAll(async () => {
  await truncateDocuments();
});

test('an incoming letter is registered, accepted, forwarded, complied with and archived', async ({
  actingAs,
}) => {
  const records = await actingAs('records');

  await test.step('1.1 registration confers no custody', async () => {
    await registerDocument(records, {
      title: TITLE,
      direction: 'Incoming',
      type: 'Letter',
      division: 'Office of the Regional Director',
      section: 'Records Unit',
      sender: 'Provincial Assessor, Benguet',
    });

    // Deterministic because the counters are truncated per spec, which is the whole reason they are
    // in the truncation list.
    await expect(records.getByText(`DTS-${YEAR}-000001`)).toBeVisible();
    /*
     * En route (PENDING), not In process. Decision 154: creating a document writes an unaccepted handoff to
     * the unit it was registered for, and `PENDING` is derived from the existence of that row
     * (ADR-0005) rather than stored. A document that read as In process here would be one nobody
     * had taken responsibility for.
     */
    await expect(status(records)).toHaveText('En route');
  });

  await test.step('1.2 nothing moves before the holding unit takes it on', async () => {
    await expect(currentlyWith(records)).toHaveText('Office of the Regional Director');

    /*
     * The assertion this scenario exists for. Decision 155 gates every onward action on the lead
     * hop having been accepted, so an officer holding `DOCUMENT_COMPLY`, `DOCUMENT_ARCHIVE` and
     * `DOCUMENT_ASSIGN` is still offered exactly one button.
     */
    await expect(action(records, 'Accept custody')).toBeVisible();
    await expect(action(records, 'Record compliance')).toHaveCount(0);
    await expect(action(records, 'Archive')).toHaveCount(0);

    await runAction(records, 'Accept custody', 'In process');
    await expect(timeline(records)).toContainText('Accepted by Office of the Regional Director');
  });

  await test.step('1.3 the scan is not downloadable until it is clean', async () => {
    await uploadAttachment(records, 'survey-plan-request.pdf');

    // Fail-closed, and visibly so: no download control exists at all while the verdict is pending,
    // rather than a disabled one (policy register P-07).
    await expect(attachments(records).getByText('Scan pending')).toBeVisible();
    await expect(attachments(records).getByRole('button', { name: 'Download' })).toHaveCount(0);

    await waitForScanClean(records);
    await expect(attachments(records).getByRole('button', { name: 'Download' })).toBeVisible();
  });

  await test.step('1.4 the forward names one lead and one informed copy', async () => {
    await records.getByRole('button', { name: 'Forward', exact: true }).click();
    const dialog = records.getByRole('dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Forward to another division' }),
    ).toBeVisible();

    await dialog.getByRole('combobox', { name: 'Receiving division' }).click();
    await records.getByRole('option', { name: 'Pilot Division', exact: true }).click();

    /*
     * Left at "Division-level (no section)", which is what lets the receiving division decide who
     * takes it: a hop addressed to a section can only be accepted from inside that section.
     *
     * The copies are checkboxes rather than a multi-select, and a Radix checkbox is a `button` with
     * `role="checkbox"` — the enclosing `<label>` is decoration, because a button is not a
     * labelable element — so the control is reached through the label's text, not by it.
     */
    await dialog
      .locator('label', { hasText: 'Lands Management Division' })
      .getByRole('checkbox')
      .check();
    await dialog.getByLabel('Remarks (optional)').fill('For action. Reply within 7 days.');
    await dialog.getByRole('button', { name: 'Forward document' }).click();
    await expect(dialog).toBeHidden();

    await expect(currentlyWith(records)).toHaveText('Pilot Division');
    await expect(status(records)).toHaveText('En route');

    /*
     * Exactly one recipient leads and takes custody; the rest are consulted and never waited on
     * (decision 24 as amended / ADR-0005, decisions 159–160). Both rows are on the timeline, and
     * the copy says what it is.
     */
    await expect(timeline(records)).toContainText('Forwarded to Pilot Division');
    await expect(timeline(records)).toContainText(
      'Copied to Lands Management Division for information',
    );
  });

  await test.step('1.5 the lead acts on it, with remarks', async () => {
    const staff = await actingAs('staff');
    await openDocumentFromRegistry(staff, TITLE);

    await expect(action(staff, 'Accept custody')).toBeVisible();
    await expect(action(staff, 'Record compliance')).toHaveCount(0);

    await runAction(staff, 'Accept custody', 'In process');

    /*
     * Decision 163: an incoming document terminates by being acted upon **with remarks**, and the
     * remark is the record of what was done — so the dialog is mandatory and the server refuses the
     * command without it (`COMPLY_REMARKS_REQUIRED`).
     */
    await runAction(staff, 'Record compliance', 'Complied', {
      remarks: 'Certified copy issued and released to the requesting office.',
    });
    await expect(timeline(staff)).toContainText('Certified copy issued');
  });

  await test.step('1.6 closing the record', async () => {
    await records.reload();
    await runAction(records, 'Archive', 'Archived');

    // A closed record's files and fields no longer change, but its printable dossier is exactly
    // what people still need (decision 170).
    await expect(records.getByRole('button', { name: 'Forward', exact: true })).toHaveCount(0);
    await expect(records.getByRole('button', { name: 'Edit metadata' })).toHaveCount(0);
    await expect(records.getByRole('button', { name: 'Routing slip' })).toBeVisible();
  });
});
