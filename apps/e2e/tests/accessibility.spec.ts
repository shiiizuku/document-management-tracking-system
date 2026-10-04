import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';
import { DIVISIONS, SECTIONS } from '../fixtures/accounts';
import { apiPost } from '../fixtures/api';
import { truncateDocuments } from '../fixtures/database';
import { expect, test } from '../fixtures/test';

/**
 * The accessibility sweep (C4 of `docs/phase-7-sequencing.md`).
 *
 * Run here rather than in jsdom for two reasons the sequencing document gives: it is cheaper, and
 * it is the only way to catch the problems that are properties of a real layout — focus order,
 * contrast as actually computed, a control that is only reachable with a pointer. A jsdom sweep can
 * tell you an input has no label; it cannot tell you the skip link lands nowhere.
 *
 * **The bar is zero `critical` violations**, which is the done-when. Everything axe reports at a
 * lower impact is attached to the test report instead of failing the run: `serious` findings are
 * worth fixing and are not worth blocking a pilot on, and a sweep that fails on all four impacts
 * tends to get skipped rather than read.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Scans the page as it currently stands and fails on `critical` findings only.
 *
 * The whole page, with no exclusions. An `exclude` here is a decision that some part of the screen
 * does not have to be accessible, and there is nothing on these screens that qualifies.
 */
const sweep = async (page: Page, info: TestInfo): Promise<void> => {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();

  // Attached whatever the outcome, so a passing run still records what was found. The report is
  // the only place a `serious` finding is visible, since it does not fail anything.
  await info.attach(`axe-${info.title.replaceAll(/[^a-z0-9]+/gi, '-')}.json`, {
    contentType: 'application/json',
    body: JSON.stringify(results.violations, null, 2),
  });

  const critical = results.violations.filter((violation) => violation.impact === 'critical');
  expect(
    critical.map((violation) => `${violation.id} — ${violation.help} (${violation.nodes.length})`),
  ).toEqual([]);
};

test.beforeAll(async () => {
  await truncateDocuments();
});

test.describe('unauthenticated screens', () => {
  test('the sign-in screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to the DTS' })).toBeVisible();
    await sweep(page, test.info());
  });

  // Not in C4's list, and swept anyway: it is the only screen an unauthenticated member of the
  // public fills in, so it is the one where a labelling mistake reaches someone with no support.
  test('the account request form', async ({ page }) => {
    await page.goto('/request-account');
    // Named, not `level: 1`: this route has two `h1`s at desktop width — the story panel's and the
    // form's — so an unnamed query matches both.
    await expect(page.getByRole('heading', { name: 'Apply for an account' })).toBeVisible();
    await sweep(page, test.info());
  });
});

test.describe('authenticated screens', () => {
  /*
   * Swept as the administrator, which holds every capability in the table — so one session reaches
   * the reporting, audit and administration screens as well as the everyday ones. Gating is the
   * subject of the authorization tests, not of this sweep.
   */
  const ROUTES = [
    { path: '/dashboard', heading: /Dashboard|Good day/ },
    { path: '/documents', heading: 'Documents' },
    { path: '/my-work', heading: 'My work' },
    { path: '/reports', heading: 'Monthly register' },
    { path: '/audit', heading: 'Audit trail' },
    { path: '/admin/users', heading: 'Users' },
    { path: '/admin/requests', heading: 'Account requests' },
    { path: '/admin/organization', heading: 'Divisions' },
  ] as const;

  for (const route of ROUTES) {
    test(`${route.path}`, async ({ actingAs }) => {
      const page = await actingAs('admin');
      await page.goto(route.path);
      // Waiting on the heading rather than on `networkidle`: these screens fetch on mount and the
      // heading is what says the session resolved and the shell rendered, which is the state worth
      // scanning. Scanning the loading spinner would pass trivially.
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
      await sweep(page, test.info());
    });
  }

  /*
   * The detail page needs a document, and it is the densest screen in the app: two columns, a
   * sticky rail, a definition list, the attachment panel and the timeline. One is conjured over
   * REST because registering it through the dialog would be testing the dialog.
   */
  test('/documents/[id]', async ({ actingAs }) => {
    const page = await actingAs('admin');
    const document = await apiPost<{ id: string }>(page, '/documents', {
      title: 'Accessibility sweep fixture',
      type: 'LETTER',
      direction: 'INCOMING',
      priority: 'NORMAL',
      sender: 'Provincial Assessor, Benguet',
      divisionId: DIVISIONS.ord.id,
      sectionId: SECTIONS.records.id,
      description: 'A record with enough on it that the detail layout is worth scanning.',
    });

    await page.goto(`/documents/${document.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Accessibility sweep fixture' }),
    ).toBeVisible();
    await sweep(page, test.info());
  });

  /*
   * A dialog is a different layout with its own focus trap and its own labelling, and it is drawn
   * over the page rather than in it — so the sweep above never sees one. The registration dialog is
   * the largest in the app and the one with every input type on it.
   */
  test('the registration dialog', async ({ actingAs }) => {
    const page = await actingAs('admin');
    await page.goto('/documents');
    await page.getByRole('button', { name: 'Register document' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Register document' })).toBeVisible();
    // Open the collapsed panels too: a labelling mistake inside one is invisible while it is shut.
    await dialog.getByRole('button', { name: /More details/ }).click();
    await dialog.getByRole('button', { name: /Attachments/ }).click();
    await sweep(page, test.info());
  });
});
