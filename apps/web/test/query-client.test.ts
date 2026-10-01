import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/lib/api';
import { createQueryClient, loginRedirectTarget, shouldRetry } from '../src/lib/query-client';

const apiError = (status: number) =>
  new ApiError({ status, code: `HTTP_${status}`, message: 'nope' });

describe('shouldRetry', () => {
  it('never retries a 4xx, because the server will answer the same way', () => {
    expect(shouldRetry(0, apiError(400))).toBe(false);
    expect(shouldRetry(0, apiError(401))).toBe(false);
    expect(shouldRetry(0, apiError(403))).toBe(false);
    expect(shouldRetry(0, apiError(409))).toBe(false);
  });

  it('retries 5xx and network failures up to the cap', () => {
    expect(shouldRetry(0, apiError(503))).toBe(true);
    expect(shouldRetry(1, apiError(503))).toBe(true);
    expect(shouldRetry(2, apiError(503))).toBe(false);
    expect(shouldRetry(0, new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('loginRedirectTarget', () => {
  it('preserves where the user was so they land back after signing in', () => {
    expect(loginRedirectTarget('/documents/doc-1')).toBe('/login?next=%2Fdocuments%2Fdoc-1');
    expect(loginRedirectTarget('/documents', '?status=PENDING&page=2')).toBe(
      '/login?next=%2Fdocuments%3Fstatus%3DPENDING%26page%3D2',
    );
  });

  it('does not add a redundant next for the root', () => {
    expect(loginRedirectTarget('/')).toBe('/login');
  });

  it('returns null on the login screen itself, so a failed sign-in cannot loop', () => {
    expect(loginRedirectTarget('/login')).toBeNull();
    expect(loginRedirectTarget('/login?next=%2Fdocuments')).toBeNull();
  });
});

describe('createQueryClient session expiry', () => {
  const failing = (error: Error) => ({
    queryKey: ['documents'],
    queryFn: () => Promise.reject(error),
    retry: false,
  });

  it('clears cached data and notifies once when a query hits 401', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient({ onUnauthenticated });
    client.setQueryData(['documents'], [{ id: 'doc-1' }]);

    // A different key, so the seeded entry is not simply served from cache under staleTime.
    await client
      .fetchQuery({ ...failing(apiError(401)), queryKey: ['detail'] })
      .catch(() => undefined);

    expect(onUnauthenticated).toHaveBeenCalledOnce();
    // Cached data belonged to the dead session and must not reach the next user.
    expect(client.getQueryData(['documents'])).toBeUndefined();
  });

  it('notifies once even though a dead session fails every in-flight query', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient({ onUnauthenticated });

    await Promise.allSettled([
      client.fetchQuery({ ...failing(apiError(401)), queryKey: ['a'] }),
      client.fetchQuery({ ...failing(apiError(401)), queryKey: ['b'] }),
      client.fetchQuery({ ...failing(apiError(401)), queryKey: ['c'] }),
    ]);

    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('leaves other failures alone — a 403 is not a session problem', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient({ onUnauthenticated });
    client.setQueryData(['documents'], [{ id: 'doc-1' }]);

    await client
      .fetchQuery({ ...failing(apiError(403)), queryKey: ['other'] })
      .catch(() => undefined);

    expect(onUnauthenticated).not.toHaveBeenCalled();
    expect(client.getQueryData(['documents'])).toEqual([{ id: 'doc-1' }]);
  });

  it('also catches a 401 raised by a mutation', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient({ onUnauthenticated });

    await client
      .getMutationCache()
      .build(client, { mutationFn: () => Promise.reject(apiError(401)) })
      .execute(undefined)
      .catch(() => undefined);

    expect(onUnauthenticated).toHaveBeenCalledOnce();
  });

  it('ignores a plain Error, which carries no status', async () => {
    const onUnauthenticated = vi.fn();
    const client = createQueryClient({ onUnauthenticated });

    await client
      .fetchQuery({ ...failing(new Error('boom')), queryKey: ['plain'] })
      .catch(() => undefined);

    expect(onUnauthenticated).not.toHaveBeenCalled();
  });
});
