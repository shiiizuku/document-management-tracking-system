'use client';

import { useQuery } from '@tanstack/react-query';
import type { RoleGrant } from '@dts/contracts';
import { api } from '@/lib/api';

/**
 * What each role grants, from `GET /roles` — served only to the people who assign roles.
 *
 * **Display data for the role picker, and nothing else.** Nothing may gate a control on
 * `grants[role].capabilities`: what the signed-in user may do comes from the session's own
 * capability array (`/auth/me`), because gating on this map would anticipate the server's answer
 * instead of asking for it. A lint rule keeps this module unreachable outside `features/admin`.
 *
 * The table only changes on deploy, so it is fetched once per session.
 */
export function useRoleGrants() {
  return useQuery({
    queryKey: ['roles'] as const,
    queryFn: () => api<RoleGrant[]>('/roles'),
    staleTime: Infinity,
  });
}
