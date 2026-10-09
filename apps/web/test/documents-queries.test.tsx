import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DOCUMENT_FILTERS,
  invalidateDocument,
  presentedStatus,
  useAssignedDocuments,
  useRunAction,
  useUpdateMetadata,
} from '../src/features/documents/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import type { RouteEntry } from '../src/features/documents/queries';
import { documentDetail, documentItem } from './fixtures';
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

  // The realtime adapter's only lever is `invalidateDocument`, so an assignment arriving while the
  // dashboard is open must refetch the queue its "Your move" strip counts — not wait for a refocus.
  it('refetches the assigned queue, so the dashboard count follows an assignment', async () => {
    const { client, wrapper } = harness();
    apiMock.mockResolvedValue({ items: [], total: 0, nextCursor: null });
    const { result } = renderHook(() => useAssignedDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    invalidateDocument(client, undefined);

    await waitFor(() =>
      expect(apiMock.mock.calls.filter(([path]) => path === '/documents/assigned')).toHaveLength(2),
    );
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
  /*
   * The action endpoint answers with the document's SUMMARY — the registry's row shape — not the
   * detail. Seeding the detail cache from it was the original implementation, and it put an object
   * with no `allowedActions` where the detail screen reads one, so the screen crashed on the render
   * straight after every successful action. The fixture here is the summary for that reason: a
   * detail-shaped one hides the bug by supplying fields the server never sends.
   */
  it('refetches the detail rather than seeding it from a response that is only a summary', async () => {
    const stale = documentDetail({ status: 'PENDING', version: 3 });
    apiMock.mockResolvedValue(documentItem({ status: 'IN_PROCESS', version: 4 }));
    const { client, invalidate, wrapper } = harness();
    client.setQueryData(['documents', 'detail', 'doc-1'], stale);
    const { result } = renderHook(() => useRunAction('doc-1'), { wrapper });

    result.current.mutate({ action: 'ACCEPT', expectedVersion: 3 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['documents', 'detail', 'doc-1']));
    // Whatever is in the detail entry must still be a detail: never a summary without actions.
    expect(client.getQueryData(['documents', 'detail', 'doc-1'])).toHaveProperty('allowedActions');
  });

  it('settles every cached list page, because the row has moved between filtered views', async () => {
    apiMock.mockResolvedValue(documentItem({ status: 'IN_PROCESS', version: 4 }));
    const { invalidate, wrapper } = harness();
    const { result } = renderHook(() => useRunAction('doc-1'), { wrapper });

    result.current.mutate({ action: 'ACCEPT', expectedVersion: 3 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys(invalidate)).toContain(JSON.stringify(['documents', 'list']));
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

/*
 * Decision 154: registration confers no custody, so a document is Pending while its lead hop is
 * unaccepted even though the column says IN_PROCESS. The rail showed the column alone, which put
 * "In process" beside an "Accept custody" button — found by performing
 * `docs/acceptance-scenarios.md` §2.1 end to end.
 */
describe('presentedStatus', () => {
  const hop = (overrides: Partial<RouteEntry> = {}): RouteEntry => ({
    id: 'route-1',
    fromDivisionId: null,
    toDivisionId: 'division-a',
    toSectionId: null,
    routedById: 'user-1',
    remarks: null,
    forInformation: false,
    acceptedAt: null,
    acceptedById: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  });

  it('reads Pending while the lead hop is unaccepted', () => {
    expect(presentedStatus(documentDetail({ status: 'IN_PROCESS', routes: [hop()] }))).toBe(
      'PENDING',
    );
  });

  it('reads the stored status once the lead hop is accepted', () => {
    const accepted = hop({ acceptedAt: '2026-10-04T01:00:00.000Z', acceptedById: 'user-2' });
    expect(presentedStatus(documentDetail({ status: 'IN_PROCESS', routes: [accepted] }))).toBe(
      'IN_PROCESS',
    );
  });

  // A copy is never waited on (decisions 159–160), so it cannot hold the badge at Pending after
  // the lead has accepted and acted.
  it('ignores an unacknowledged for-information copy', () => {
    const lead = hop({ acceptedAt: '2026-10-04T01:00:00.000Z', acceptedById: 'user-2' });
    const copy = hop({ id: 'route-2', toDivisionId: 'division-c', forInformation: true });
    expect(presentedStatus(documentDetail({ status: 'COMPLIED', routes: [lead, copy] }))).toBe(
      'COMPLIED',
    );
  });
});
