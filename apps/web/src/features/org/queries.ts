'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The division and section tree, as every placement picker needs it.
 *
 * Registering a document, forwarding one, approving an account request and editing a user all ask
 * the same two questions — which divisions exist, and which sections belong to this one — so they
 * ask them here and share one cached answer.
 */

export interface Division {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface Section {
  id: string;
  divisionId: string;
  code: string;
  name: string;
  active: boolean;
}

const orgKeys = {
  divisions: ['org', 'divisions'] as const,
  sections: (divisionId: string) => ['org', 'sections', divisionId] as const,
};

/**
 * The org chart changes a few times a year, not a few times a minute, so it is cached for the
 * session rather than re-fetched on the app-wide 30-second default. Every picker that opens would
 * otherwise re-request a list that cannot have changed.
 */
const ORG_STALE_TIME = 30 * 60_000;

export function useDivisions() {
  return useQuery({
    queryKey: orgKeys.divisions,
    queryFn: () => api<Division[]>('/divisions'),
    staleTime: ORG_STALE_TIME,
  });
}

/**
 * The sections of one division. Idle until a division is chosen: with no division there is
 * nothing to ask for, and `/sections` without a filter is not a request this app ever wants.
 */
export function useSections(divisionId: string | null) {
  return useQuery({
    queryKey: orgKeys.sections(divisionId ?? ''),
    queryFn: () => api<Section[]>(`/sections?divisionId=${encodeURIComponent(divisionId ?? '')}`),
    enabled: divisionId !== null && divisionId !== '',
    staleTime: ORG_STALE_TIME,
  });
}
