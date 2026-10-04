import { test as base, type BrowserContext, type Page } from '@playwright/test';
import type { SignedInRole } from './accounts';
import { BASE_URL } from './environment';
import { storageStatePath } from './paths';

/**
 * The suite's `test`, extended with the one thing these journeys all need: several principals in
 * one scenario.
 *
 * Both acceptance journeys are hand-offs. The incoming one passes a document from the Records
 * Officer to a division's staff and back; the outgoing one needs the division head, then the
 * Regional Director for exactly one hop, then the Records Officer. Playwright's built-in `page`
 * gives one context per test, so a spec that needs three signs them in itself — from the sessions
 * `auth.setup.ts` already saved, never by logging in again, because `POST /auth/login` allows five
 * a minute and this suite spends all five once.
 *
 * `baseURL` is passed explicitly: a context made from `browser.newContext()` does not inherit the
 * project's `use` options, so without it every relative `page.goto('/documents')` would fail.
 */
export interface ActorFixtures {
  /** A page already signed in as that role. Closed with its context when the test ends. */
  actingAs: (role: SignedInRole) => Promise<Page>;
}

export const test = base.extend<ActorFixtures>({
  actingAs: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];

    await use(async (role) => {
      const context = await browser.newContext({
        baseURL: BASE_URL,
        storageState: storageStatePath(role),
      });
      contexts.push(context);
      return context.newPage();
    });

    for (const context of contexts) await context.close();
  },
});

export { expect } from '@playwright/test';
