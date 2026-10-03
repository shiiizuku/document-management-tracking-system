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
import { api, download } from '@/lib/api';

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

/**
 * The document classes the office tracks (policy register P-01).
 *
 * The column is free text in the database and the contract caps it at 80 characters, so this list
 * is the whole of the restriction: it fills the create form and the registry filter, and nothing
 * server-side refuses a value outside it. Adding a class is a one-line change here; removing one
 * does not retire the documents already filed under it.
 */
export const DOCUMENT_TYPES = [
  'MEMORANDUM',
  'FOI_REQUEST',
  'SPECIAL_ORDER',
  'LETTER',
  'DENR_8888_ACTION_CENTER',
] as const;

/** Fields the API will sort by. Anything else is rejected server-side, so this list is the truth. */
export const DOCUMENT_SORT_FIELDS = ['createdAt', 'priority', 'status'] as const;
export type DocumentSortField = (typeof DOCUMENT_SORT_FIELDS)[number];

export interface DocumentFilters {
  search: string;
  status: string;
  priority: string;
  type: string;
  direction: string;
  /** A division id, as the dashboard's chart links through with. '' means every division. */
  divisionId: string;
  sort: DocumentSortField;
  order: 'asc' | 'desc';
}

export const DEFAULT_DOCUMENT_FILTERS: DocumentFilters = {
  search: '',
  status: '',
  priority: '',
  type: '',
  direction: '',
  divisionId: '',
  sort: 'createdAt',
  order: 'desc',
};

/** A document as the registry list serves it. Dates arrive as ISO strings over the wire. */
export interface DocumentListItem {
  id: string;
  trackingNumber: string;
  referenceNumber: string | null;
  /** Contact address for the correspondent. Separate from `referenceNumber`, which is uniquely
   *  indexed and so cannot hold an address two documents legitimately share. */
  email: string | null;
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
  /** A copy for information: read and remark only, and never what the workflow waits on. */
  forInformation: boolean;
  acceptedAt: string | null;
  acceptedById: string | null;
  createdAt: string;
}

/**
 * Where the document is now — the most recent hop that took custody, or the registering placement
 * when it has never been forwarded.
 *
 * `document.divisionId` is not this. Forwarding is non-destructive (ADR-0005), so that column
 * records where the document was registered and stops moving after the first hop; the server's
 * `custodyDivisionId` is the same answer computed in SQL.
 */
export const currentCustody = (
  document: DocumentDetail,
): { divisionId: string; sectionId: string | null } => {
  const hops = document.routes.filter((hop) => !hop.forInformation);
  const lead = hops[hops.length - 1];
  if (lead === undefined) return { divisionId: document.divisionId, sectionId: document.sectionId };
  return { divisionId: lead.toDivisionId, sectionId: lead.toSectionId };
};

/**
 * A referenced document as the detail payload summarises it — enough to list it and to open the
 * modal, and nothing more.
 */
export interface ReferenceDocumentSummary {
  id: string;
  trackingNumber: string;
  title: string;
  direction: DocumentDirection;
  status: WorkflowStatus;
  createdAt: string;
}

export interface DocumentDetail extends DocumentListItem {
  assigneeUserIds: string[];
  sharedUserIds: string[];
  /**
   * The two directions of the Reference Document relation (decision 165), each already filtered by
   * this reader's own scope on the server. An outgoing document fills `referencedDocuments` — what
   * it answers — and an incoming one fills `replyDocuments`, the outgoing documents that name it.
   *
   * **Short by omission, never nulled** (decision 166): a reference the reader may not read is
   * simply absent, with nothing marking its place. Two readers legitimately see different lengths
   * for the same document, and the UI must render exactly what is here — no count from another
   * source, no "1 reference hidden", no placeholder row.
   */
  referencedDocuments: ReferenceDocumentSummary[];
  replyDocuments: ReferenceDocumentSummary[];
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
  // Under `lists()` so that `invalidateDocument` settles it with every other cached list: a
  // released document must not keep showing as pending in the palette either.
  search: (term: string) => [...documentKeys.lists(), 'search', term] as const,
  detail: (id: string) => [...documentKeys.all, 'detail', id] as const,
  revisions: (id: string) => [...documentKeys.all, 'revisions', id] as const,
  deleted: () => [...documentKeys.all, 'deleted'] as const,
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
  if (filters.divisionId) params.set('divisionId', filters.divisionId);
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

export function useDocument(id: string, enabled = true) {
  return useQuery({
    queryKey: documentKeys.detail(id),
    queryFn: () => api<DocumentDetail>(`/documents/${id}`),
    enabled,
  });
}

/** How many matches the command palette offers before telling the user to open the registry. */
export const DOCUMENT_SEARCH_LIMIT = 6;

/** Below this, a term is too short to be worth a request — two characters match almost anything. */
export const DOCUMENT_SEARCH_MIN_LENGTH = 2;

/**
 * A handful of documents matching a typed term, for the command palette's jump-to.
 *
 * Deliberately not `useDocuments` with a search filter: that hook is the registry's, keyed on the
 * full filter set and a page, and its cache entries are the rows a user navigates back to. This is
 * keyed on the term alone and capped at {@link DOCUMENT_SEARCH_LIMIT}, because the palette is
 * asking a different question — "which document do you mean" rather than "show me this view".
 *
 * `enabled` is the caller's, so a closed palette holds no subscription at all.
 */
export function useDocumentSearch(term: string, enabled: boolean) {
  const search = term.trim();
  return useQuery({
    queryKey: documentKeys.search(search),
    queryFn: () =>
      api<DocumentPage>(
        `/documents?${documentsQueryString(
          { ...DEFAULT_DOCUMENT_FILTERS, search },
          1,
          DOCUMENT_SEARCH_LIMIT,
        )}`,
      ),
    enabled: enabled && search.length >= DOCUMENT_SEARCH_MIN_LENGTH,
    // Keeps the previous term's matches listed while the next request is in flight, so the list
    // narrows as the user types instead of emptying between keystrokes.
    placeholderData: (previous) => previous,
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
  // Deletion and restore move a row between the registry and the deleted list, so the two are
  // always settled together: a restored document that is still listed as deleted is a row the
  // user can press Restore on twice.
  void client.invalidateQueries({ queryKey: documentKeys.deleted() });
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

/**
 * Runs one of the server-offered workflow actions against a document.
 *
 * The response is the document's summary — the same shape the registry lists — and **not** the
 * detail: it carries no `allowedActions`, timeline or routes. So the detail is invalidated and
 * refetched rather than seeded from it. Seeding looks like the cheaper option and is how this was
 * first written, but it writes a summary into the detail cache entry, and the next render of the
 * detail screen then reads `allowedActions` off an object that has none.
 */
export function useRunAction(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ...body }: WorkflowCommand) =>
      api<DocumentListItem>(`/documents/${id}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateDocument(client, id),
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
  email?: string | null | undefined;
  confidential?: boolean | undefined;
  /** An ISO instant to set a target date, `null` to clear it. Omitted leaves it alone. */
  dueAt?: string | null | undefined;
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

/**
 * The documents this user could restore.
 *
 * A deleted document is invisible to every other read path — the registry omits it and the detail
 * route answers 404 — so this list is the only way to reach one, and the only source of the
 * `version` that `useRestoreDocument` has to send. Enabled on demand rather than always: it is
 * read by one dialog, and fetching a deleted-items list for every visit to the registry would ask
 * a question nobody on screen has.
 */
export function useDeletedDocuments(enabled: boolean) {
  return useQuery({
    queryKey: documentKeys.deleted(),
    queryFn: () => api<DocumentListItem[]>('/documents/deleted'),
    enabled,
  });
}

/**
 * Logically deletes a document.
 *
 * `expectedVersion` is required for the same reason every other mutation carries it: deleting a
 * document someone else has just moved on is exactly the mistake optimistic concurrency exists to
 * stop. The row is not destroyed — {@link useRestoreDocument} reverses this — but it leaves every
 * list and its own detail route, so callers navigate away on success.
 */
export function useDeleteDocument(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ expectedVersion }: { expectedVersion: number }) =>
      api<DocumentListItem>(`/documents/${id}`, {
        method: 'DELETE',
        body: JSON.stringify({ expectedVersion }),
      }),
    // The detail query is invalidated too, so a user who stays on the page gets the "not
    // available" state rather than a cached copy of a document that no longer exists.
    onSuccess: () => invalidateDocument(client, id),
    onError: () => invalidateDocument(client, id),
  });
}

/** Reverses a logical deletion, returning the document to the registry. */
export function useRestoreDocument() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, expectedVersion }: { id: string; expectedVersion: number }) =>
      api<DocumentListItem>(`/documents/${id}/restore`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion }),
      }),
    onSuccess: (_restored, { id }) => invalidateDocument(client, id),
    onError: (_error, { id }) => invalidateDocument(client, id),
  });
}

/**
 * Downloads the printable routing slip — the dossier that travels with the physical document.
 *
 * Through `download()` rather than a link for the same reason as every other export: the request
 * needs the session cookie, and a refusal must appear beside the button instead of replacing the
 * page with an error document.
 */
export function useRoutingSlip() {
  return useMutation({
    mutationFn: ({ id, trackingNumber }: { id: string; trackingNumber: string }) =>
      download(`/documents/${id}/routing-slip.pdf`, `routing-slip-${trackingNumber}.pdf`),
  });
}

/**
 * Links an incoming document as a Reference Document of this outgoing one (decisions 165, 179).
 *
 * One request per id, because the contract takes one id per call: a batch would have to report
 * which of several ids was refused, and under decision 166 that report is the leak. No
 * `expectedVersion` — linking changes nothing on the document row and bumps no version — so unlike
 * every other mutation here there is no stale-write conflict to handle.
 */
export function useLinkReference(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (incomingDocumentId: string) =>
      api<DocumentDetail>(`/documents/${id}/references`, {
        method: 'POST',
        body: JSON.stringify({ incomingDocumentId }),
      }),
    onSuccess: () => invalidateDocument(client, id),
  });
}

/** Removes a link. A target that does not exist and one outside the reader's scope both 404. */
export function useUnlinkReference(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (incomingDocumentId: string) =>
      api<DocumentDetail>(`/documents/${id}/references/${incomingDocumentId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => invalidateDocument(client, id),
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
