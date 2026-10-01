'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreateDocumentInput,
  DocumentDirection,
  DocumentPriority,
  ReleaseMethod,
  WorkflowAction,
  WorkflowStatus,
} from '@dts/contracts';
import { api } from '@/lib/api';

/**
 * Everything the browser knows about documents.
 *
 * The screens above this module ask for data and run commands; they never see a cache key, build
 * a query string, or decide what a mutation invalidates. That last part is the point: eight
 * different mutations change a document, and every one of them has to settle the detail view AND
 * every cached list page, because a status change moves a row between filters. Spread across the
 * screens, that rule is wrong somewhere within a week — most visibly as a list that still shows
 * PENDING after the user accepted the document in front of them.
 *
 * It also means a cache-key change is a change to this file only, which is what lets the realtime
 * adapter invalidate "this document" without learning how documents are keyed.
 */

export const DOCUMENT_PAGE_SIZE = 20;

export const DOCUMENT_TYPES = ['MEMORANDUM', 'FOI_REQUEST', 'SPECIAL_ORDER', 'LETTER'] as const;

/** Fields the API will sort by. Anything else is rejected server-side, so this list is the truth. */
export const DOCUMENT_SORT_FIELDS = ['createdAt', 'priority', 'status'] as const;
export type DocumentSortField = (typeof DOCUMENT_SORT_FIELDS)[number];

export interface DocumentFilters {
  search: string;
  status: string;
  priority: string;
  type: string;
  direction: string;
  sort: DocumentSortField;
  order: 'asc' | 'desc';
}

export const DEFAULT_DOCUMENT_FILTERS: DocumentFilters = {
  search: '',
  status: '',
  priority: '',
  type: '',
  direction: '',
  sort: 'createdAt',
  order: 'desc',
};

/** A document as the registry list serves it. Dates arrive as ISO strings over the wire. */
export interface DocumentListItem {
  id: string;
  trackingNumber: string;
  referenceNumber: string | null;
  title: string;
  type: string;
  description: string | null;
  priority: DocumentPriority;
  direction: DocumentDirection;
  status: WorkflowStatus;
  sender: string | null;
  company: string | null;
  divisionId: string;
  sectionId: string | null;
  createdById: string;
  confidential: boolean;
  dueAt: string | null;
  version: number;
  currentAttachmentVersionId: string | null;
  signedAttachmentVersionId: string | null;
  hasCleanCurrentAttachment: boolean;
  releaseMethod: ReleaseMethod | null;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEntry {
  id: string;
  sequence: number;
  actorId: string;
  action: string;
  fromStatus: WorkflowStatus | null;
  toStatus: WorkflowStatus;
  remarks: string | null;
  occurredAt: string;
}

export interface RouteEntry {
  id: string;
  fromDivisionId: string | null;
  toDivisionId: string;
  toSectionId: string | null;
  routedById: string;
  remarks: string | null;
  createdAt: string;
}

export interface DocumentDetail extends DocumentListItem {
  assigneeUserIds: string[];
  sharedUserIds: string[];
  routes: RouteEntry[];
  signatures: Array<{ id: string; fileVersionId: string; signerId: string; signedAt: string }>;
  timeline: TimelineEntry[];
  /**
   * What this actor may do to this document right now, decided by the server from the workflow
   * state and their capabilities. The client renders this list and never computes its own.
   */
  allowedActions: WorkflowAction[];
}

export interface DocumentPage {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MetadataRevision {
  id: string;
  actorId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  occurredAt: string;
}

/**
 * Cache keys. Private to this module: the exported hooks and `invalidateDocument` are the only
 * ways in, so nothing outside can hold a key that this file later changes.
 */
const documentKeys = {
  all: ['documents'] as const,
  lists: () => [...documentKeys.all, 'list'] as const,
  list: (filters: DocumentFilters, page: number) =>
    [...documentKeys.lists(), { ...filters, page }] as const,
  detail: (id: string) => [...documentKeys.all, 'detail', id] as const,
  revisions: (id: string) => [...documentKeys.all, 'revisions', id] as const,
};

/**
 * Builds the list query string. Empty filters are omitted so the request carries only what
 * narrows it. Exported for its own test: it is the one place a filter name can be mistyped, and
 * the symptom is silently unfiltered results rather than an error.
 */
export const documentsQueryString = (
  filters: DocumentFilters,
  page: number,
  pageSize: number = DOCUMENT_PAGE_SIZE,
): string => {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.type) params.set('type', filters.type);
  if (filters.direction) params.set('direction', filters.direction);
  params.set('sort', filters.sort);
  params.set('order', filters.order);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  return params.toString();
};

export function useDocuments(filters: DocumentFilters, page: number) {
  return useQuery({
    queryKey: documentKeys.list(filters, page),
    queryFn: () => api<DocumentPage>(`/documents?${documentsQueryString(filters, page)}`),
    // Keeps the previous page's rows on screen while the next one loads, so paging and filtering
    // dim the table rather than emptying it.
    placeholderData: (previous) => previous,
  });
}

export function useDocument(id: string) {
  return useQuery({
    queryKey: documentKeys.detail(id),
    queryFn: () => api<DocumentDetail>(`/documents/${id}`),
  });
}

export function useMetadataRevisions(id: string, enabled = true) {
  return useQuery({
    queryKey: documentKeys.revisions(id),
    queryFn: () => api<MetadataRevision[]>(`/documents/${id}/metadata-revisions`),
    enabled,
  });
}

/**
 * Settles everything a change to one document can affect: its detail, its revision history, and
 * every cached list page — a status or priority change moves the row between filtered views, so
 * invalidating only the page the user is looking at leaves the others wrong.
 *
 * Exported as a plain function, not a hook, because the realtime adapter calls it from an event
 * handler. It is the seam that lets that adapter say "this document changed" without knowing how
 * documents are cached.
 */
export function invalidateDocument(client: QueryClient, id?: string): void {
  if (id !== undefined) {
    void client.invalidateQueries({ queryKey: documentKeys.detail(id) });
    void client.invalidateQueries({ queryKey: documentKeys.revisions(id) });
  }
  void client.invalidateQueries({ queryKey: documentKeys.lists() });
}

export interface WorkflowCommand {
  action: WorkflowAction;
  /**
   * The version the user was looking at. The server rejects the command with a 409 if the
   * document has moved on since, which is what stops two people acting on the same stale view.
   */
  expectedVersion: number;
  remarks?: string | undefined;
  releaseMethod?: ReleaseMethod | undefined;
}

/** Runs one of the server-offered workflow actions against a document. */
export function useRunAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...body }: WorkflowCommand) =>
      api<DocumentDetail>(`/documents/${id}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (detail) => {
      // The response is the fresh document, so seed it rather than refetching what we just got.
      client.setQueryData(documentKeys.detail(id), detail);
      invalidateDocument(client, undefined);
    },
    // A 409 means the caller's copy was stale. Refetch so the retry is against reality; the
    // screen only has to tell the user it changed.
    onError: () => invalidateDocument(client, id),
  });
}

/**
 * A metadata change. Every field is optional — only what changed is sent — and the text fields
 * accept `null`, which is how the API is told to clear one. An omitted field and a `null` field
 * mean different things, so the two cannot be collapsed.
 */
export interface MetadataPatch {
  expectedVersion: number;
  title?: string | undefined;
  type?: string | undefined;
  description?: string | null | undefined;
  priority?: DocumentPriority | undefined;
  sender?: string | null | undefined;
  company?: string | null | undefined;
  referenceNumber?: string | null | undefined;
  confidential?: boolean | undefined;
}

export function useUpdateMetadata(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (patch: MetadataPatch) =>
      api<DocumentDetail>(`/documents/${id}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => invalidateDocument(client, id),
    onError: () => invalidateDocument(client, id),
  });
}

export interface RouteCommand {
  expectedVersion: number;
  toDivisionId: string;
  toSectionId?: string | undefined;
  remarks?: string | undefined;
}

/** Forwards a document to another division or section. */
export function useRouteDocument(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: RouteCommand) =>
      api<DocumentDetail>(`/documents/${id}/routes`, {
        method: 'POST',
        body: JSON.stringify(command),
      }),
    onSuccess: () => invalidateDocument(client, id),
    onError: () => invalidateDocument(client, id),
  });
}

export function useCreateDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateDocumentInput) =>
      api<DocumentListItem>('/documents', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateDocument(client, undefined),
  });
}
