import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DOCUMENT_FILTERS,
  invalidateDocument,
  useRunAction,
  useUpdateMetadata,
} from '../src/features/documents/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail } from './fixtures';
import { invalidatedKeys, requestBody } from './mock-api';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

const harness = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, invalidate, wrapper };
};

afterEach(() => {
  vi.clearAllMocks();
});

/*
 * These assertions are about cache discipline, which is this module's whole reason to exist. Eight
 * mutations change a document, and every one has to settle both the record and every cached list
 * page, because a status change moves a row between filtered views. The visible symptom of
 * getting it wrong is a registry still showing PENDING for a document the user just accepted.
 */
describe('invalidateDocument', () => {
  it('settles the record, its history and every cached list page', () => {
    const { client, invalidate } = harness();

    invalidateDocument(client, 'doc-1');

    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(['documents', 'detail', 'doc-1']));
    expect(keys).toContain(JSON.stringify(['documents', 'revisions', 'doc-1']));
    expect(keys).toContain(JSON.stringify(['documents', 'list']));
  });

  it('settles the lists when no particular document is named', () => {
    const { client, invalidate } = harness();

    invalidateDocument(client, undefined);

    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(['documents', 'list']));
    expect(keys).not.toContain(JSON.stringify(['documents', 'detail', 'doc-1']));
  });

  /*
   * Deletion and restore move a row between the registry and the deleted list, so the two are
   * always settled together. Settling only one leaves a restored document still listed as deleted —
   * a row the user can press Restore on a second time, against a version that no longer exists.
   */
  it('settles the deleted list alongside the registry', () => {
    const { client, invalidate } = harness();

    invalidateDocument(client, 'doc-1');

    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['documents', 'deleted']));
  });

  // The key factory is private, so a list key must be reachable by the prefix the invalidation
  // uses. If these ever diverge, a mutation stops refreshing the list it changed.
  it('matches a cached list page by prefix, filters and page included', () => {
    const { client } = harness();
    const listKey = ['documents', 'list', { ...DEFAULT_DOCUMENT_FILTERS, page: 2 }];
    client.setQueryData(listKey, { items: [], total: 0, page: 2, pageSize: 20 });

    const matched = client
      .getQueryCache()
      .findAll({ queryKey: ['documents', 'list'] })
      .map((query) => query.queryKey);

    expect(matched).toHaveLength(1);
    expect(matched[0]).toEqual(listKey);
  });
});

describe('useRunAction', () => {
  it('seeds the fresh document from the response instead of refetching it', async () => {
    const updated = documentDetail({ status: 'IN_PROCESS', version: 4 });
    apiMock.mockResolvedValue(updated);
    const { client, wrapper } = harness();
    const { result } = renderHook(() => useRunAction('doc-1'), { wrapper });

    result.current.mutate({ action: 'ACCEPT', expectedVersion: 3 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(['documents', 'detail', 'doc-1'])).toEqual(updated);
  });

  /*
   * A 409 means the caller's copy was stale. Refetching here is what lets the screen say "this
   * changed — review and retry" over a document that is already current, rather than leaving the
   * user to reload the page themselves.
   */
  it('refetches the document after a conflict so the retry is against reality', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 409, code: 'DOCUMENT_CONFLICT', message: 'Version conflict' }),
    );
    const { invalidate, wrapper } = harness();
    const { result } = renderHook(() => useRunAction('doc-1'), { wrapper });

    result.current.mutate({ action: 'ACCEPT', expectedVersion: 3 });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['documents', 'detail', 'doc-1']));
  });
});

describe('useUpdateMetadata', () => {
  it('settles the record and the lists on success', async () => {
    apiMock.mockResolvedValue(documentDetail({ title: 'Renamed' }));
    const { invalidate, wrapper } = harness();
    const { result } = renderHook(() => useUpdateMetadata('doc-1'), { wrapper });

    result.current.mutate({ expectedVersion: 3, title: 'Renamed' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = invalidatedKeys(invalidate);
    expect(keys).toContain(JSON.stringify(['documents', 'detail', 'doc-1']));
    expect(keys).toContain(JSON.stringify(['documents', 'list']));
  });

  it('sends null to clear a field, which is different from omitting it', async () => {
    apiMock.mockResolvedValue(documentDetail());
    const { wrapper } = harness();
    const { result } = renderHook(() => useUpdateMetadata('doc-1'), { wrapper });

    result.current.mutate({ expectedVersion: 3, sender: null });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requestBody(apiMock, '/documents/doc-1/metadata')).toEqual({
      expectedVersion: 3,
      sender: null,
    });
  });
});
