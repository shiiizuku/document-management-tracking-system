import { expect, type Locator, type Page } from '@playwright/test';
import { cleanPdfUpload } from './pdf';

/**
 * The screens, as the specs talk about them.
 *
 * Everything here is phrased in the words printed on the control, because
 * `docs/acceptance-scenarios.md` is written that way and the specs are meant to be a
 * transcription of it. Where a locator needs scoping, it is scoped to a landmark or a heading
 * rather than to a class name: `main aside` is the detail rail by construction (the shell's
 * sidebar is the page's other `<aside>`, and it is outside `<main>`), and the attachments panel is
 * found by its own heading.
 */

/** The detail page's right-hand rail: status, where the document is, and the action buttons. */
export const rail = (page: Page): Locator => page.locator('main aside');

/**
 * Every label `StatusBadge` can print. Listed so the badge can be found by what it says rather
 * than by its position or its classes, which is the difference between a locator that survives a
 * refactor of the rail and one that does not.
 */
const STATUS_LABELS = [
  'Pending',
  'In process',
  'For revision',
  'For initial',
  'For signature',
  'Signed',
  'For release',
  'Released',
  'Complied',
  'Archived',
] as const;

/**
 * The status pill.
 *
 * Anchored on the whole of the element's own text, so it cannot also match the timeline's
 * `IN PROCESS → FOR SIGNATURE` transition line or an action button — `Archive` the button and
 * `Archived` the status are different strings, deliberately.
 */
export const status = (page: Page): Locator =>
  rail(page).getByText(new RegExp(`^(${STATUS_LABELS.join('|')})$`));

/**
 * Where the document is now — the most recent lead hop (decision 177), not `documents.division_id`.
 *
 * The value is the `<p>` that follows the heading inside its own group; XPath because "the sibling
 * of this heading" is exactly the relationship, and a CSS ancestor filter would match every
 * enclosing `div` as well.
 */
export const currentlyWith = (page: Page): Locator =>
  rail(page).locator('h2', { hasText: 'Currently with' }).locator('xpath=following-sibling::p');

/** One of the server-offered workflow actions. Absent means unreachable, which is an assertion. */
export const action = (page: Page, label: string): Locator =>
  rail(page).getByRole('button', { name: label, exact: true });

export const timeline = (page: Page): Locator => rail(page).getByRole('list');

export const attachments = (page: Page): Locator =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Attachments' }) });

export interface RegistrationFields {
  title: string;
  direction: 'Incoming' | 'Outgoing';
  /** The type as the picker labels it, e.g. `Letter` — not the `LETTER` wire value. */
  type: string;
  /** The division's name, e.g. `Pilot Division`. */
  division: string;
  /** A section's name. Omitted registers at division level, which is not the same thing. */
  section?: string;
  sender?: string;
}

/**
 * Registers a document from the registry and waits for the record it lands on.
 *
 * The dialog navigates to the new document on success, so the arrival at `/documents/<uuid>` is
 * both the wait and the assertion that the create succeeded — a validation failure keeps the
 * dialog open and the URL unchanged.
 */
export const registerDocument = async (page: Page, fields: RegistrationFields): Promise<void> => {
  await page.goto('/documents');
  await page.getByRole('button', { name: 'Register document' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Register document' })).toBeVisible();

  await dialog.getByLabel('Title').fill(fields.title);
  await chooseOption(dialog, 'Direction', fields.direction);
  await chooseOption(dialog, 'Type', fields.type);
  await chooseOption(dialog, 'Division', fields.division);
  // Only on an incoming document: the field is hidden on an outgoing one, where a sender has no
  // meaning (`createDocumentSchema` requires it for incoming and nothing else).
  if (fields.sender !== undefined)
    // Exact: the optional section also has a `Sender’s reference` field.
    await dialog.getByLabel('Sender', { exact: true }).fill(fields.sender);

  if (fields.section !== undefined) {
    await dialog.getByRole('button', { name: /More details/ }).click();
    await chooseOption(dialog, 'Section', fields.section);
  }

  await dialog.getByRole('button', { name: 'Register document' }).click();
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/);
};

/** A Radix select: open the trigger its label points at, then pick the option by its text. */
const chooseOption = async (scope: Locator, label: string, option: string): Promise<void> => {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  // The listbox is portalled out of the dialog, so it is addressed from the page, not the scope.
  await scope.page().getByRole('option', { name: option, exact: true }).click();
};

/**
 * Attaches a file through the record's own Upload control.
 *
 * The native input is hidden behind the button by design, and `setInputFiles` does not need it to
 * be visible — it sets the files and fires the change event the component listens for, which is
 * exactly what pressing the button and picking a file in the OS dialog would do.
 */
export const uploadAttachment = async (page: Page, filename: string): Promise<void> => {
  await expect(page.getByRole('button', { name: 'Upload file' })).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles(cleanPdfUpload(filename));
  await expect(attachments(page).getByText(filename)).toBeVisible();
};

/**
 * Waits for the scanner's verdict, reloading until it shows.
 *
 * **The reload is the point, not a workaround.** The verdict is written by the worker and no
 * realtime message is published for it, so an open detail page keeps showing `Scan pending`
 * indefinitely. `docs/acceptance-scenarios.md` §1.3 records the same thing for a human executor;
 * if that ever changes, this becomes a plain `toBeVisible` and the note in the scenarios goes.
 */
export const waitForScanClean = async (page: Page): Promise<void> => {
  await expect(async () => {
    await page.reload();
    await expect(attachments(page).getByText('Clean', { exact: true })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 90_000, intervals: [1_000] });
};

/** Opens a document from the registry by its title, the way a user finds one. */
export const openDocumentFromRegistry = async (page: Page, title: string): Promise<void> => {
  await page.goto('/documents');
  await page.getByRole('row').filter({ hasText: title }).click();
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
};

/**
 * Runs a workflow action and waits for the status it should produce.
 *
 * Actions that need input open a dialog instead of sending immediately, so the caller passes what
 * the dialog asks for. Which actions those are is the server's rule, mirrored in
 * `use-action-runner.tsx`'s `ACTION_REQUIRES`; passing remarks for an action that does not collect
 * them would hang on a dialog that never appears, which is why this takes them explicitly rather
 * than guessing.
 */
export const runAction = async (
  page: Page,
  label: string,
  expected: string,
  input?: { remarks?: string; method?: string; trackingReference?: string },
): Promise<void> => {
  await action(page, label).click();

  if (input !== undefined) {
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: label })).toBeVisible();
    if (input.method !== undefined) await chooseOption(dialog, 'Delivery method', input.method);
    if (input.trackingReference !== undefined)
      await dialog.getByLabel(/tracking reference/i).fill(input.trackingReference);
    if (input.remarks !== undefined) await dialog.getByLabel(/^Remarks/).fill(input.remarks);
    await dialog.getByRole('button', { name: label, exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  await expect(status(page)).toHaveText(expected);
};
