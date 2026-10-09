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

  /*
   * Divisions are rows, not an enum, so the division filter is checked for shape. The dashboard
   * chart links through with this parameter, so a mangled one has to fail closed rather than
   * reach the API.
   */
  it('keeps a division filter that looks like an id', () => {
    const id = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
    expect(parseDocumentFilters(params(`divisionId=${id}`)).divisionId).toBe(id);
  });

  it.each([
    ['a non-uuid', 'divisionId=all'],
    ['an injection attempt', "divisionId=1'%20or%20'1'='1"],
  ])('drops %s in the division filter', (_label, query) => {
    expect(parseDocumentFilters(params(query)).divisionId).toBe('');
  });

  // The dashboard's Overdue tile links to `?overdue=true`; only that exact value is a filter.
  it.each([
    ['true', true],
    ['false', false],
    ['1', false],
    ['', false],
  ])('reads overdue=%s as %s', (value, expected) => {
    expect(parseDocumentFilters(params(`overdue=${value}`)).overdue).toBe(expected);
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
      divisionId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      sectionId: '7a9c1e2f-3b4d-4c5e-8f6a-1b2c3d4e5f6a',
      overdue: true,
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

  it('notices the overdue filter', () => {
    expect(hasActiveDocumentFilters({ ...DEFAULT_DOCUMENT_FILTERS, overdue: true })).toBe(true);
  });

  it('counts whitespace-only search as no search', () => {
    expect(hasActiveDocumentFilters({ ...DEFAULT_DOCUMENT_FILTERS, search: '   ' })).toBe(false);
  });

  it.each(['status', 'priority', 'type', 'direction', 'divisionId', 'sectionId'] as const)(
    'notices a %s filter',
    (field) => {
      expect(hasActiveDocumentFilters({ ...DEFAULT_DOCUMENT_FILTERS, [field]: 'X' })).toBe(true);
    },
  );
});

describe('documentsQueryString', () => {
  it('always sends paging and sort, and omits unset filters', () => {
    const query = new URLSearchParams(documentsQueryString(DEFAULT_DOCUMENT_FILTERS, 1));
    expect(query.get('sort')).toBe('createdAt');
    expect(query.get('order')).toBe('desc');
    expect(query.get('page')).toBe('1');
    expect(query.get('pageSize')).toBe('20');
    expect(query.get('status')).toBeNull();
    expect(query.get('overdue')).toBeNull();
  });

  it('sends overdue=true to the API when the filter is on', () => {
    const query = new URLSearchParams(
      documentsQueryString({ ...DEFAULT_DOCUMENT_FILTERS, overdue: true }, 1),
    );
    expect(query.get('overdue')).toBe('true');
  });

  it('trims the free-text search so a stray space is not part of the match', () => {
    const query = new URLSearchParams(
      documentsQueryString({ ...DEFAULT_DOCUMENT_FILTERS, search: '  DTS-2026  ' }, 1),
    );
    expect(query.get('search')).toBe('DTS-2026');
  });
});
