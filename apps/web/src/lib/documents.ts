import { api } from './api';

export const DOCUMENT_STATUSES = [
  'PENDING',
  'IN_PROCESS',
  'FOR_REVISION',
  'FOR_SIGNATURE',
  'SIGNED',
  'FOR_RELEASE',
  'RELEASED',
  'ARCHIVED',
] as const;
export const DOCUMENT_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const DOCUMENT_DIRECTIONS = ['INCOMING', 'OUTGOING'] as const;
export const DOCUMENT_TYPES = ['MEMORANDUM', 'FOI_REQUEST', 'SPECIAL_ORDER', 'LETTER'] as const;
export const DOCUMENT_SORTS = ['createdAt', 'priority', 'status'] as const;

export type DocumentSort = (typeof DOCUMENT_SORTS)[number];
export type SortOrder = 'asc' | 'desc';

export interface DocumentFilters {
  search: string;
  status: string;
  priority: string;
  type: string;
  direction: string;
  sort: DocumentSort;
  order: SortOrder;
}

export const DEFAULT_FILTERS: DocumentFilters = {
  search: '',
  status: '',
  priority: '',
  type: '',
  direction: '',
  sort: 'createdAt',
  order: 'desc',
};

export const DEFAULT_PAGE_SIZE = 20;

export interface DocumentListItem {
  id: string;
  title: string;
  trackingNumber: string;
  referenceNumber: string | null;
  status: string;
  priority: string;
  type: string;
  direction: string;
  sender: string | null;
  company: string | null;
  divisionId: string;
  sectionId: string | null;
  createdAt: string;
  version: number;
}

export interface DocumentListPage {
  items: DocumentListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Builds the `/documents` query string from the active filters and page. Empty filters are
 * omitted so the URL carries only what narrows the query. Pure, so the mapping is unit-tested
 * without a network call.
 */
export const documentsQuery = (
  filters: DocumentFilters,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
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

export const fetchDocuments = (
  filters: DocumentFilters,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<DocumentListPage> =>
  api<DocumentListPage>(`/documents?${documentsQuery(filters, page, pageSize)}`);

/** Total number of pages for a result set, at least 1 so the pager always has a current page. */
export const pageCount = (total: number, pageSize: number = DEFAULT_PAGE_SIZE): number =>
  Math.max(1, Math.ceil(total / pageSize));
