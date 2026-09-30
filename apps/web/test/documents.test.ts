import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS, documentsQuery, pageCount } from '../src/lib/documents';

describe('documentsQuery', () => {
  it('includes only the filters that narrow the query, plus sort and paging', () => {
    const query = documentsQuery(DEFAULT_FILTERS, 1);
    const params = new URLSearchParams(query);
    expect(params.get('sort')).toBe('createdAt');
    expect(params.get('order')).toBe('desc');
    expect(params.get('page')).toBe('1');
    expect(params.get('pageSize')).toBe('20');
    // No empty filter keys leak into the query.
    expect(params.has('status')).toBe(false);
    expect(params.has('search')).toBe(false);
  });

  it('serializes active filters and trims the search term', () => {
    const params = new URLSearchParams(
      documentsQuery(
        { ...DEFAULT_FILTERS, search: '  memo  ', status: 'PENDING', priority: 'HIGH' },
        3,
      ),
    );
    expect(params.get('search')).toBe('memo');
    expect(params.get('status')).toBe('PENDING');
    expect(params.get('priority')).toBe('HIGH');
    expect(params.get('page')).toBe('3');
  });
});

describe('pageCount', () => {
  it('rounds up and never drops below one', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(pageCount(41)).toBe(3);
  });
});
