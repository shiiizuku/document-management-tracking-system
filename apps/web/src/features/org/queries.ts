'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDivisionInput,
  CreateSectionInput,
  UpdateDivisionInput,
  UpdateSectionInput,
} from '@dts/contracts';
import { api } from '@/lib/api';

/**
 * The division and section tree: how every placement picker reads it, and how the organization
 * console changes it.
 *
 * Registering a document, forwarding one, approving an account request and editing a user all ask
 * the same two questions — which divisions exist, and which sections belong to this one — so they
 * ask them here and share one cached answer.
 *
 * The mutations live beside those reads because of how aggressively that answer is cached. The tree
 * is held for half an hour on the grounds that it changes a few times a year; the one moment it
 * does change is an edit made *here*, and a console whose own save did not appear for thirty
 * minutes would be read as a failure. Keeping both in one module is what makes that impossible to
 * get wrong.
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

/**
 * Settles the whole tree after any change to it.
 *
 * Everything under `['org']` rather than the one list that changed: deactivating a division has to
 * drop the section lists cached beneath it, and renaming one changes a label that pickers all over
 * the app are showing. The tree is small and read rarely enough that the precision is not worth the
 * chance of missing a case.
 */
const invalidateOrg = (client: ReturnType<typeof useQueryClient>): void => {
  void client.invalidateQueries({ queryKey: ['org'] });
};

export function useCreateDivision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDivisionInput) =>
      api<Division>('/divisions', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateOrg(client),
  });
}

export function useUpdateDivision() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDivisionInput }) =>
      api<Division>(`/divisions/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => invalidateOrg(client),
  });
}

export function useCreateSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSectionInput) =>
      api<Section>('/sections', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateOrg(client),
  });
}

export function useUpdateSection() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateSectionInput }) =>
      api<Section>(`/sections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => invalidateOrg(client),
  });
}
