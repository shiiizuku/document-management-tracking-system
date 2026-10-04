import { expect, test as setup } from '@playwright/test';
import { ACCOUNTS, SIGNED_IN_ROLES } from '../fixtures/accounts';
import { storageStatePath } from '../fixtures/paths';

/**
 * Signs in once per principal and saves the session for the rest of the run.
 *
 * This is the only place in the suite that authenticates, and it is the reason the specs can have
 * four actors between them: `POST /auth/login` is throttled to five requests a minute per client
 * (decision register 68), so a suite that signed in per spec would be refused within its first
 * minute. `SIGNED_IN_ROLES` is capped at five for the same reason, and `assertLoginBudget` in the
 * global setup fails readably if that cap is ever exceeded.
 *
 * The sessions stay valid for the whole run because the organization and the accounts are seeded
 * once and never reseeded — the credential is a stateless JWT keyed on the user's id (ADR-0002),
 * so a saved state outlives everything except a new id. See `fixtures/database.ts`.
 *
 * It also happens to be the only test of the sign-in screen's happy path, which is worth saying
 * out loud: if the login form breaks, every spec in the suite fails here rather than mysteriously
 * later.
 */
for (const role of SIGNED_IN_ROLES) {
  const account = ACCOUNTS[role];

  setup(`sign in as the ${account.displayName}`, async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // `safeNextPath` sends a sign-in with no `?next=` to the dashboard. Waiting for the heading as
    // well as the URL is what proves the session was actually accepted: the `(app)` layout renders
    // nothing but a spinner until `/auth/me` answers, and renders nothing at all while a 401 is on
    // its way back to `/login`.
    await page.waitForURL('**/dashboard');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.context().storageState({ path: storageStatePath(role) });
  });
}
