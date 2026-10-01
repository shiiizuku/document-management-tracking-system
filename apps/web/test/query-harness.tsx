import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';

/**
 * Renders a component tree with its own query cache.
 *
 * Retries are off and `staleTime` is zero: a test that asserts on an error state should not wait
 * through the app's retry policy first, and a test that asserts a refetch happened should not be
 * served the previous answer. The cache is per call, so no test can see another's data.
 */
export function renderWithQuery(ui: ReactNode): RenderResult & { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}
