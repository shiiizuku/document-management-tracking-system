'use client';

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Capability, ChangePasswordInput, LoginInput, Role } from '@dts/contracts';
import { api, inlineContent, upload, type InlineContent } from '@/lib/api';

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
 * Signs out, then clears the cache and returns to the landing page at `/`.
 *
 * Deliberately `onSettled`, not `onSuccess`: the user asked to leave, so a failed or offline
 * logout must still leave no cached records on the screen or in memory. The cookie may outlive
 * that, but the session is already invalid server-side in every case that matters.
 */
export function useLogout() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    onSettled: async () => {
      // Stop in-flight and scheduled fetches first. The shell is still mounted until the route
      // changes, and clearing the cache under it makes `useSession` refetch, get a 401, and send
      // the user to /login instead of the landing page.
      await client.cancelQueries();
      client.clear();
      // A full navigation, not router.replace: it also resets the QueryClient's one-shot 401 latch
      // and drops every in-memory leftover of the ended session.
      window.location.replace('/');
    },
  });
}

/**
 * Changes the signed-in user's own password.
 *
 * The server ends every session the user holds and answers this request with a fresh session
 * cookie, so the caller stays signed in with nothing to refetch. The new CSRF cookie arrives with
 * it, and `api()` reads that cookie on every request.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      api<void>('/me/password', { method: 'POST', body: JSON.stringify(input) }),
  });
}

/** Largest photo the API accepts (`MAX_PROFILE_PHOTO_BYTES`); checked here so the refusal is instant. */
export const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
export const PROFILE_PHOTO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

const photoStampKey = ['session', 'photo-stamp'] as const;

const watchedClients = new WeakSet<QueryClient>();

/**
 * Revokes a photo's object URL when its cache entry is removed.
 *
 * Registered once per client rather than per component: the removal happens *after* the last
 * consumer has unmounted, so a subscription owned by a component would already be gone. Releasing
 * twice is harmless, which is why a repeated removal needs no bookkeeping.
 */
const releaseOnRemoval = (client: QueryClient): void => {
  if (watchedClients.has(client)) return;
  watchedClients.add(client);
  client.getQueryCache().subscribe((event) => {
    const { queryKey } = event.query as { queryKey: readonly unknown[] };
    if (event.type !== 'removed' || queryKey[0] !== 'session' || queryKey[1] !== 'photo') return;
    (event.query.state.data as InlineContent | undefined)?.release();
  });
};

/**
 * The signed-in user's photo as an object URL, or `null` when they have none.
 *
 * Fetched through `inlineContent` rather than pointed at by an `<img src>`: the API is a different
 * origin in development and the photo needs the session cookie, which an image request to another
 * site does not carry. The cache key carries an upload stamp, so a replaced photo is fetched again.
 *
 * The object URL belongs to the cache entry, not to the component: the shell mounts this hook twice
 * on a phone (the desktop menu stays mounted under the navigation sheet), and revoking from one
 * consumer's cleanup would break the other's image. It is revoked when the entry is removed — which
 * `gcTime: 0` does as soon as the last consumer goes, and `client.clear()` does on sign-out.
 * The bytes are fetched with `no-store` because `/me/photo` is one URL for every user: the browser's
 * own cache is not partitioned by session, so a second person on the same browser could be served
 * the first one's photo.
 */
export function useProfilePhotoUrl(): string | null {
  const client = useQueryClient();
  const stamp = useQuery({
    queryKey: photoStampKey,
    queryFn: () => 0,
    enabled: false,
    initialData: 0,
    staleTime: Infinity,
  }).data;
  // `/auth/me` does not say whether a photo exists, `/me` does; asking first avoids a 404 on every
  // page load for the people who never set one.
  const has = useQuery({
    queryKey: ['session', 'has-photo', stamp] as const,
    queryFn: () => api<{ hasPhoto: boolean }>('/me').then((me) => me.hasPhoto),
    staleTime: Infinity,
    retry: false,
  });
  const enabled = has.data === true;
  const query = useQuery({
    queryKey: ['session', 'photo', stamp] as const,
    queryFn: async () => {
      const content = await inlineContent('/me/photo', { cache: 'no-store' });
      releaseOnRemoval(client);
      return content;
    },
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const content = query.data;
  return enabled && content !== undefined ? content.url : null;
}

/**
 * Uploads the signed-in user's own photo. On success the cache stamp moves, so the avatar
 * fetches the new image instead of the cached one.
 */
export function useUploadProfilePhoto() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return upload<{ mediaType: string; sizeBytes: number }>('/me/photo', body);
    },
    // A new stamp changes both cache keys above, so the check and the image are fetched afresh.
    onSuccess: () => client.setQueryData(photoStampKey, Date.now()),
  });
}
