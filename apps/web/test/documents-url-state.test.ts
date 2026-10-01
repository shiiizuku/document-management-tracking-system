import { describe, expect, it } from 'vitest';
import { DEFAULT_DOCUMENT_FILTERS, documentsQueryString } from '../src/features/documents/queries';
import {
  documentFiltersToParams,
  hasActiveDocumentFilters,
  parseDocumentFilters,
  parsePage,
} from '../src/features/documents/url-state';

const params = (query: string) => new URLSearchParams(query);

describe('reading registry filters from the URL', () => {
  it('reads a filtered link back as the filters it describes', () => {
    const filters = parseDocumentFilters(params('search=memo&status=PENDING&priority=URGENT'));
    expect(filters.search).toBe('memo');
    expect(filters.status).toBe('PENDING');
    expect(filters.priority).toBe('URGENT');
  });

  // These parameters come from whatever the user typed in the address bar. Passing an
  // unrecognised status straight through would turn a typo into a server error.
  it('drops a filter value outside the contract vocabulary', () => {
    const filters = parseDocumentFilters(params('status=NOT_A_STATUS&direction=SIDEWAYS'));
    expect(filters.status).toBe('');
    expect(filters.direction).toBe('');
  });

  it('falls back to the default sort rather than to no sort at all', () => {
    const filters = parseDocumentFilters(params('sort=whatever&order=sideways'));
    expect(filters.sort).toBe(DEFAULT_DOCUMENT_FILTERS.sort);
    expect(filters.order).toBe('desc');
  });

  it('accepts the sort fields the API supports', () => {
    expect(parseDocumentFilters(params('sort=priority&order=asc')).sort).toBe('priority');
    expect(parseDocumentFilters(params('sort=priority&order=asc')).order).toBe('asc');
  });

  it.each([
    ['no page', '', 1],
    ['a page number', 'page=4', 4],
    ['a non-numeric page', 'page=abc', 1],
    ['a zero page', 'page=0', 1],
    ['a negative page', 'page=-2', 1],
    ['a fractional page', 'page=1.5', 1],
  ])('reads %s as page %i', (_label, query, expected) => {
    expect(parsePage(params(query))).toBe(expected);
  });
});

describe('writing registry filters to the URL', () => {
  // The unfiltered registry should be reachable at a clean `/documents`, not at a URL carrying a
  // row of empty parameters.
  it('writes nothing for an unfiltered first page', () => {
    expect(documentFiltersToParams(DEFAULT_DOCUMENT_FILTERS, 1)).toBe('');
  });

  it('writes only what narrows the view', () => {
    const query = documentFiltersToParams(
      { ...DEFAULT_DOCUMENT_FILTERS, status: 'PENDING', search: '  memo  ' },
      3,
    );
    expect(new URLSearchParams(query).get('status')).toBe('PENDING');
    expect(new URLSearchParams(query).get('search')).toBe('memo');
    expect(new URLSearchParams(query).get('page')).toBe('3');
    expect(new URLSearchParams(query).get('priority')).toBeNull();
  });

  it('round-trips every filter it writes', () => {
    const filters = {
      search: 'budget',
      status: 'FOR_SIGNATURE',
      priority: 'HIGH',
      type: 'SPECIAL_ORDER',
      direction: 'OUTGOING',
      sort: 'status',
      order: 'asc',
    } as const;
    const query = documentFiltersToParams(filters, 2);

    expect(parseDocumentFilters(new URLSearchParams(query))).toEqual(filters);
    expect(parsePage(new URLSearchParams(query))).toBe(2);
  });
});

describe('hasActiveDocumentFilters', () => {
  it('ignores sort and page, which narrow nothing', () => {
    expect(
      hasActiveDocumentFilters({ ...DEFAULT_DOCUMENT_FILTERS, sort: 'status', order: 'asc' }),
    ).toBe(false);
  });

  it('counts whitespace-only search as no search', () => {
    expect(hasActiveDocumentFilters({ ...DEFAULT_DOCUMENT_FILTERS, search: '   ' })).toBe(false);
  });

  it.each(['status', 'priority', 'type', 'direction'] as const)('notices a %s filter', (field) => {
    expect(hasActiveDocumentFilters({ ...DEFAULT_DOCUMENT_FILTERS, [field]: 'X' })).toBe(true);
  });
});

describe('documentsQueryString', () => {
  it('always sends paging and sort, and omits unset filters', () => {
    const query = new URLSearchParams(documentsQueryString(DEFAULT_DOCUMENT_FILTERS, 1));
    expect(query.get('sort')).toBe('createdAt');
    expect(query.get('order')).toBe('desc');
    expect(query.get('page')).toBe('1');
    expect(query.get('pageSize')).toBe('20');
    expect(query.get('status')).toBeNull();
  });

  it('trims the free-text search so a stray space is not part of the match', () => {
    const query = new URLSearchParams(
      documentsQueryString({ ...DEFAULT_DOCUMENT_FILTERS, search: '  DTS-2026  ' }, 1),
    );
    expect(query.get('search')).toBe('DTS-2026');
  });
});
