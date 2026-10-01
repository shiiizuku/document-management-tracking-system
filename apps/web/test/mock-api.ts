/**
 * Readers for what a mocked `api()` was called with, and for what a spied QueryClient was asked to
 * invalidate.
 *
 * Both are structurally typed rather than reaching for `vi.fn()`'s own generics, which resolve to
 * `any` and make every assertion built on them an unsafe-member-access lint error. Shared so each
 * test file is not re-deriving "which path did it request" with its own cast.
 */

/** Just enough of a `vi.fn()` or `vi.spyOn()` to read its call list. */
interface RecordedCalls {
  mock: { calls: unknown[][] };
}

/** Every path a mocked `api()` / `download()` was called with, in call order. */
export const calledPaths = (mock: RecordedCalls): string[] =>
  mock.mock.calls.map((call) => String(call[0]));

/** The first path matching a predicate, for asserting on a request among several. */
export const calledPath = (
  mock: RecordedCalls,
  matches: (path: string) => boolean,
): string | undefined => calledPaths(mock).find(matches);

/**
 * The parsed JSON body of the first request to `path`. Returns `{}` when there was none, so a
 * test asserting on a field fails on that field rather than on a thrown type error.
 */
export const requestBody = (mock: RecordedCalls, path: string): Record<string, unknown> => {
  const call = mock.mock.calls.find((entry) => entry[0] === path);
  const init = call?.[1];
  if (typeof init !== 'object' || init === null) return {};
  const body = (init as { body?: unknown }).body;
  return typeof body === 'string' ? (JSON.parse(body) as Record<string, unknown>) : {};
};

/**
 * The query keys a spied `invalidateQueries` was called with, JSON-encoded so they compare as
 * values. Encoding rather than deep-equality keeps the assertions readable:
 * `expect(keys).toContain(JSON.stringify(['documents', 'list']))`.
 */
export const invalidatedKeys = (spy: RecordedCalls): string[] =>
  spy.mock.calls.map((call) => {
    const filters = call[0];
    const queryKey =
      typeof filters === 'object' && filters !== null
        ? (filters as { queryKey?: unknown }).queryKey
        : undefined;
    return JSON.stringify(queryKey);
  });
