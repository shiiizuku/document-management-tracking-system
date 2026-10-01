import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Builds the app's QueryClient and centralises the two policies every screen would otherwise
 * re-implement: what is worth retrying, and what happens when the session dies.
 *
 * Kept free of React so both policies can be tested without mounting a tree or a router. The
 * caller supplies only the navigation half of the session-expiry response; clearing the cache is
 * this module's job, since it owns the cache.
 */

/** Attempts after the first failure, for errors that might genuinely be transient. */
const MAX_RETRIES = 2;

/**
 * A 4xx is the server's considered answer — a bad request, a denied scope, a missing record — and
 * repeating it only delays the error the user needs to see. Retries are for the failures that may
 * resolve on their own: network drops and 5xx.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < MAX_RETRIES;
}

/**
 * Where to send someone whose session has expired, preserving what they were looking at so they
 * land back there after signing in. Returns null when they are already on the login screen, which
 * is what stops a failed login from bouncing the user against itself.
 */
export function loginRedirectTarget(pathname: string, search = ''): string | null {
  if (pathname === '/login' || pathname.startsWith('/login?')) return null;
  const from = `${pathname}${search}`;
  return from === '/' ? '/login' : `/login?next=${encodeURIComponent(from)}`;
}

export interface QueryClientOptions {
  /** Navigate the user to the login screen. Called once per expiry, after the cache is cleared. */
  onUnauthenticated: (error: ApiError) => void;
}

export function createQueryClient({ onUnauthenticated }: QueryClientOptions): QueryClient {
  // A dead session fails every in-flight query at once. Without this latch the user would get one
  // toast and one navigation per query, so the first 401 wins and the rest are swallowed.
  let handled = false;

  const handle = (error: unknown): void => {
    if (!(error instanceof ApiError) || !error.isUnauthenticated || handled) return;
    handled = true;
    // Drop every cached response: it belongs to the session that just ended, and must not be
    // shown to whoever signs in next.
    client.clear();
    onUnauthenticated(error);
  };

  const client = new QueryClient({
    queryCache: new QueryCache({ onError: handle }),
    mutationCache: new MutationCache({ onError: handle }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        // The API is the source of truth for authorization, so a cached list must not outlive a
        // scope change for long. Short and explicit beats react-query's default of Infinity.
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });

  return client;
}
