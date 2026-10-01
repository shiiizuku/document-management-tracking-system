'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import type { Capability, LoginInput, Role } from '@dts/contracts';
import { api } from '@/lib/api';

/**
 * Who is signed in, and what they may do.
 *
 * The server is the only authority on both. This module's job is to ask once, cache the answer,
 * and hand screens a capability check — so no screen ever reasons from `role`, which is the
 * mistake that lets a client show a control the API will refuse.
 *
 * It also owns the two cache lifecycle moments nothing else can get right: signing in must drop
 * whatever the previous user left cached, and signing out must drop everything even if the
 * request to end the session fails.
 */

/** The actor as `/auth/me` returns it — the same object the API's guards resolve per request. */
export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  divisionId: string | null;
  sectionId: string | null;
  /**
   * The capabilities this user holds, straight from the server's role table. Typed as the
   * contract enum: a string outside it can only ever fail a gate, which is the safe direction.
   */
  capabilities: readonly Capability[];
  canAccessConfidential: boolean;
  active: boolean;
}

/**
 * This module's cache keys. Nothing outside it needs them — not even the login screen, which
 * mutates the session through `useLogin` rather than writing the cache itself.
 */
const sessionKeys = {
  current: ['session'] as const,
};

export interface SessionState {
  /** The signed-in user, or null while loading and when the session is gone. */
  user: SessionUser | null;
  /** True until the first `/auth/me` settles. Gates render nothing until it is false. */
  isLoading: boolean;
  /**
   * Why the probe failed, when it did. A 401 is handled globally (cache cleared, redirect to
   * login), so what reaches a caller here is the rest: a network drop, a 5xx, a proxy. Those have
   * to be shown and retried rather than treated as "signed out".
   */
  error: unknown;
  /** Re-runs the probe after a failure the user can retry. */
  retry: () => void;
  /**
   * Whether the user holds a capability. Fails closed: false while loading and when signed out,
   * so a gate never flashes a control the user cannot use.
   */
  can: (capability: Capability) => boolean;
}

/**
 * The session probe. Mounted by the `(app)` layout and read by anything that gates on authority.
 *
 * A 401 here needs no handling: the QueryClient's global error handler clears the cache and
 * redirects to `/login?next=…` for every 401 in the app, including this one.
 */
export function useSession(): SessionState {
  const query = useQuery({
    queryKey: sessionKeys.current,
    queryFn: () => api<SessionUser>('/auth/me'),
    // Longer than the app-wide default: a role change signs the user out anyway, so re-probing
    // the session every 30s buys nothing.
    staleTime: 5 * 60_000,
  });

  const capabilities = query.data?.capabilities;
  const can = useCallback(
    (capability: Capability) => capabilities?.includes(capability) ?? false,
    [capabilities],
  );

  return {
    user: query.data ?? null,
    isLoading: query.isPending,
    error: query.error,
    retry: query.refetch,
    can,
  };
}

/**
 * Signs in and seeds the session cache from the response, so the shell renders without a second
 * round trip to `/auth/me`.
 *
 * Every other query is dropped first. The cache may still hold the previous user's documents and
 * notifications, and their scope is not this user's.
 */
export function useLogin() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<SessionUser>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: (user) => {
      // `removeQueries` rather than `clear`: clearing would also wipe the mutation cache this
      // callback is running inside, which would reset the caller's own success state.
      client.removeQueries();
      client.setQueryData(sessionKeys.current, user);
    },
  });
}

/**
 * Signs out, then clears the cache and returns to `/login`.
 *
 * Deliberately `onSettled`, not `onSuccess`: the user asked to leave, so a failed or offline
 * logout must still leave no cached records on the screen or in memory. The cookie may outlive
 * that, but the session is already invalid server-side in every case that matters.
 */
export function useLogout() {
  const client = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      client.clear();
      router.replace('/login');
    },
  });
}
