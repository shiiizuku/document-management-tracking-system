'use client';

import { useEffect, useState } from 'react';

/**
 * A value that lags behind its source until the source stops changing.
 *
 * The registry applies free-text search on submit, so it never needed this. The command palette
 * cannot: its whole point is that the list narrows as you type, which means the term drives a
 * request — and one request per keystroke would both flood the API and let an earlier, broader
 * answer land after a later, narrower one.
 */
export function useDebounced<T>(value: T, delayMs = 200): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
