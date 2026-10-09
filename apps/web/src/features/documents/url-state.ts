import {
  documentDirectionSchema,
  documentPrioritySchema,
  workflowStatusSchema,
} from '@dts/contracts';
import { DEFAULT_DOCUMENT_FILTERS, DOCUMENT_SORT_FIELDS, type DocumentFilters } from './queries';

/**
 * The registry's filter state, read from and written to the URL.
 *
 * The URL is the only copy. A filtered registry has to be linkable, survive a reload, and come
 * back intact on the back button, and a component holding its own copy beside the URL would
 * disagree with it the first time the user pressed Back. Keeping the translation here — rather
 * than inline in the screen — makes it testable without a router, which matters because the
 * failure mode is silent: an unparsed filter does not error, it just stops filtering.
 *
 * Every value is validated against the contract enums on the way in. These parameters arrive from
 * whatever the user typed in the address bar, and passing an unrecognised status straight to the
 * API would turn a typo into a 500.
 */

const oneOf = <T extends string>(allowed: readonly T[], raw: string | null): T | '' =>
  raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : '';

/**
 * A division filter cannot be checked against a fixed list — divisions are rows, not an enum — so
 * it is checked for shape instead. A value that is not a UUID could only have been typed or
 * mangled, and forwarding it would turn that into a server error.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (raw: string | null): string => (raw !== null && UUID.test(raw) ? raw : '');

/**
 * Document types are rows the administrator maintains, and codes carried over by migration `0016`
 * predate the code format new types must follow, so only the contract's length bound is checked.
 */
const asTypeCode = (raw: string | null): string => {
  const value = raw?.trim() ?? '';
  return value.length <= 80 ? value : '';
};

export const parseDocumentFilters = (params: URLSearchParams): DocumentFilters => ({
  search: params.get('search') ?? '',
  status: oneOf(workflowStatusSchema.options, params.get('status')),
  priority: oneOf(documentPrioritySchema.options, params.get('priority')),
  type: asTypeCode(params.get('type')),
  direction: oneOf(documentDirectionSchema.options, params.get('direction')),
  divisionId: asUuid(params.get('divisionId')),
  // A section only means something inside a division, and the Section select is not rendered
  // without one, so a stray `sectionId` would narrow the list with no control or chip to remove.
  sectionId: asUuid(params.get('divisionId')) === '' ? '' : asUuid(params.get('sectionId')),
  // Only the exact value the dashboard links with; anything else is no filter, not an error.
  overdue: params.get('overdue') === 'true',
  // Unlike the filters, a missing or invalid sort falls back to a value rather than to "none":
  // the list is always ordered by something, and the server would reject an empty sort field.
  sort: oneOf(DOCUMENT_SORT_FIELDS, params.get('sort')) || DEFAULT_DOCUMENT_FILTERS.sort,
  order: params.get('order') === 'asc' ? 'asc' : 'desc',
});

/**
 * Serialises filters and page back into a query string, omitting everything left at its default.
 *
 * That omission is what keeps a shareable URL readable — `/documents?status=PENDING` rather than
 * a string of empty parameters — and it means the unfiltered registry is reached at `/documents`
 * with no query at all.
 */
export const documentFiltersToParams = (filters: DocumentFilters): string => {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.status) params.set('status', filters.status);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.type) params.set('type', filters.type);
  if (filters.direction) params.set('direction', filters.direction);
  if (filters.divisionId) params.set('divisionId', filters.divisionId);
  if (filters.sectionId) params.set('sectionId', filters.sectionId);
  if (filters.overdue) params.set('overdue', 'true');
  if (filters.sort !== DEFAULT_DOCUMENT_FILTERS.sort) params.set('sort', filters.sort);
  if (filters.order !== DEFAULT_DOCUMENT_FILTERS.order) params.set('order', filters.order);
  return params.toString();
};

/** Whether anything is narrowing the registry, which is what decides if Clear is offered. */
export const hasActiveDocumentFilters = (filters: DocumentFilters): boolean =>
  filters.search.trim() !== '' ||
  filters.status !== '' ||
  filters.priority !== '' ||
  filters.type !== '' ||
  filters.direction !== '' ||
  filters.divisionId !== '' ||
  filters.sectionId !== '' ||
  filters.overdue;
