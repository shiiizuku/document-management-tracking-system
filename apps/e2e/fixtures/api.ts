import { expect, type Page } from '@playwright/test';
import { API_BASE_URL } from './environment';

/**
 * The REST API, for the few things a spec needs to *arrange* rather than to *test*.
 *
 * `page.request` shares the browser context's cookie jar, so a page made from a saved session is
 * already authenticated here — which is the whole reason this exists rather than a second login.
 * State-changing routes also need the double-submit CSRF header, and the token is in a readable
 * cookie precisely so a client can mirror it.
 *
 * Nothing in the journey specs uses this: those are about the UI, and arranging their steps through
 * the API would be asserting that the API works, which the integration suites already do. The
 * accessibility sweep uses it to conjure one document it needs a page for.
 */
export const apiPost = async <T>(page: Page, path: string, body: unknown): Promise<T> => {
  const cookies = await page.context().cookies();
  const csrf = cookies.find((cookie) => cookie.name === 'dts_csrf')?.value;
  if (csrf === undefined)
    throw new Error('No dts_csrf cookie: this context has no session to act with.');

  const response = await page.request.post(`${API_BASE_URL}${path}`, {
    headers: { 'x-csrf-token': csrf, 'content-type': 'application/json' },
    data: body,
  });
  expect(
    response.ok(),
    `POST ${path} answered ${response.status()}: ${await response.text()}`,
  ).toBeTruthy();

  const payload = (await response.json()) as { data: T };
  return payload.data;
};
