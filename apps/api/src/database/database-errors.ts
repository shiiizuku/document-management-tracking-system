/**
 * Recognises the two ways a saturated database fails a request, so the API can answer "busy, try
 * again" (503 with `Retry-After`) instead of a generic 500.
 *
 * - pg-pool's acquire timeout: every connection was busy for `connectionTimeoutMillis`.
 * - Postgres `query_canceled` (57014): the statement ran past `statement_timeout`.
 *
 * Drizzle wraps driver errors in `DrizzleQueryError` with the original as `cause`, while a
 * transaction's own `pool.connect()` throws unwrapped, so the whole cause chain is searched.
 */
const POOL_ACQUIRE_TIMEOUT = 'timeout exceeded when trying to connect';
const QUERY_CANCELED = '57014';

export const isDatabaseBusyError = (error: unknown): boolean => {
  for (let current = error, depth = 0; current instanceof Error && depth < 5; depth += 1) {
    if (current.message === POOL_ACQUIRE_TIMEOUT) return true;
    if ((current as { code?: unknown }).code === QUERY_CANCELED) return true;
    current = current.cause;
  }
  return false;
};
