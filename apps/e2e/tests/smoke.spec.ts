import { truncateDocuments } from '../fixtures/database';
import { API_BASE_URL, WORKER_HEALTH_PORT } from '../fixtures/environment';
import { expect, test } from '../fixtures/test';

/**
 * The harness itself (C2 of `docs/phase-7-sequencing.md`): proof that the stack comes up, that a
 * saved session is accepted, and that the per-spec reset runs.
 *
 * Deliberately shallow. Everything here is infrastructure, so when a run goes wrong this is the
 * spec that says whether the problem is the harness or the journey.
 */
test.beforeAll(async () => {
  await truncateDocuments();
});

/*
 * Readiness is asserted here rather than by `webServer`, which has to gate on liveness to avoid
 * deadlocking against the global setup — see the comment on `webServer` in `playwright.config.ts`.
 * Here a failure names the dependency that is down, which is the whole reason the probes report
 * their checks individually.
 */
test('every dependency the two processes need is answering', async ({ request }) => {
  const api = await request.get(`${API_BASE_URL}/health/ready`);
  expect(api.status(), await api.text()).toBe(200);
  // The API's own request path: Postgres and the object store.
  expect(await api.json()).toMatchObject({ checks: { database: 'up', storage: 'up' } });

  const worker = await request.get(`http://localhost:${WORKER_HEALTH_PORT}/ready`);
  expect(worker.status(), await worker.text()).toBe(200);
  // The worker's: Postgres and Redis, which is what it needs to drain the outbox.
  expect(await worker.json()).toMatchObject({ checks: { database: 'up', redis: 'up' } });
});

test('the app is reachable and an unauthenticated visitor is sent to sign in', async ({ page }) => {
  await page.goto('/documents');

  // The redirect is the QueryClient's, taken once for the whole app on any 401, and it carries
  // where the visitor was going.
  await page.waitForURL(/\/login(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Sign in to the DTS' })).toBeVisible();
});

test('a saved session opens the registry without signing in again', async ({ actingAs }) => {
  const page = await actingAs('records');
  await page.goto('/documents');

  await expect(page.getByRole('heading', { level: 1, name: 'Documents' })).toBeVisible();
  // The reset ran, so the office's registry is genuinely empty rather than merely filtered.
  await expect(page.getByText('No accessible documents yet')).toBeVisible();
});

test('the seeded organization is the post-0009 tree', async ({ actingAs }) => {
  const page = await actingAs('admin');
  await page.goto('/admin/organization');
  await expect(page.getByRole('heading', { level: 1, name: 'Divisions' })).toBeVisible();

  /*
   * Decision 152, completed by migration `0009`: the Records Unit is a **Section inside the ORD**,
   * not a division of its own. Asserted as containment rather than as two separate visible
   * strings, because "both names appear on the page" was also true of the structure this replaced.
   */
  const ord = page
    .locator('main')
    .getByRole('listitem')
    .filter({ hasText: 'Office of the Regional Director' });
  await expect(ord.getByText('Records Unit')).toBeVisible();
  await expect(page.locator('main').getByText('Pilot Division')).toBeVisible();
});
