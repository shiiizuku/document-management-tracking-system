'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type {
  CreateDivisionInput,
  CreateDocumentTypeInput,
  CreateSectionInput,
  HeadOfBureau,
  UpdateDivisionInput,
  UpdateDocumentTypeInput,
  UpdateSectionInput,
} from '@dts/contracts';
import { documentTypeLabel } from '@/components/dts/status-badge';
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

/** A document type on the administrator's list. `code` is what a document stores. */
export interface DocumentType {
  id: string;
  code: string;
  label: string;
  active: boolean;
}

const orgKeys = {
  headOfBureau: ['org', 'head-of-bureau'] as const,
  documentTypes: ['org', 'document-types'] as const,
  divisions: ['org', 'divisions'] as const,
  sections: (divisionId: string) => ['org', 'sections', divisionId] as const,
};

/**
 * The org chart changes a few times a year, not a few times a minute, so it is cached for the
 * session rather than re-fetched on the app-wide 30-second default. Every picker that opens would
 * otherwise re-request a list that cannot have changed.
 */
const ORG_STALE_TIME = 30 * 60_000;

/**
 * Who every outgoing document is sent in the name of. Read by the register form to show the
 * sender it cannot change, and by the organization console, which is where it is changed.
 */
export function useHeadOfBureau() {
  return useQuery({
    queryKey: orgKeys.headOfBureau,
    queryFn: () => api<HeadOfBureau>('/office/head-of-bureau'),
    // Short, unlike the rest of the tree: the server stamps whatever it holds *now* on every
    // outgoing document, so a registrar must not confirm a sender an administrator has since changed.
    staleTime: 30_000,
  });
}

export function useUpdateHeadOfBureau() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: HeadOfBureau) =>
      api<HeadOfBureau>('/office/head-of-bureau', { method: 'PUT', body: JSON.stringify(input) }),
    onSuccess: () => invalidateOrg(client),
  });
}

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

/**
 * The document types. Under `['org']` so a change made on the administration screen settles every
 * picker through `invalidateOrg`. Administrators get retired types too; everyone else only the
 * ones on offer.
 */
export function useDocumentTypes() {
  return useQuery({
    queryKey: orgKeys.documentTypes,
    queryFn: () => api<DocumentType[]>('/document-types'),
    staleTime: ORG_STALE_TIME,
  });
}

/**
 * The display name for a stored type code: the administrator's label when the list has it, the
 * code tidied into words when it does not — while the list loads, or for a code another role's
 * list leaves out.
 */
export function useDocumentTypeLabel(): (code: string) => string {
  const types = useDocumentTypes();
  const data = types.data;
  return useCallback(
    (code: string) => data?.find((type) => type.code === code)?.label ?? documentTypeLabel(code),
    [data],
  );
}

/**
 * The types a document may be filed under now, for a type picker. `current` is kept in the list
 * even when it is retired, or has not loaded yet, so a picker never shows a blank for the value it
 * holds — editing a document filed under a retired type must not silently reclassify it.
 */
export function useOfferedDocumentTypes(current?: string): { code: string; label: string }[] {
  const types = useDocumentTypes();
  const labelOf = useDocumentTypeLabel();
  const offered = (types.data ?? [])
    .filter((type) => type.active)
    .map(({ code, label }) => ({ code, label }));
  if (current && !offered.some((type) => type.code === current))
    offered.unshift({ code: current, label: labelOf(current) });
  return offered;
}

export function useCreateDocumentType() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentTypeInput) =>
      api<DocumentType>('/document-types', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateOrg(client),
  });
}

export function useUpdateDocumentType() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateDocumentTypeInput }) =>
      api<DocumentType>(`/document-types/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => invalidateOrg(client),
  });
}
