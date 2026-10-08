import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { ThemeProvider } from '../src/components/theme-provider';
import { TooltipProvider } from '../src/components/ui/tooltip';

/**
 * Renders a component tree with its own query cache and theme context.
 *
 * Retries are off and `staleTime` is zero: a test that asserts on an error state should not wait
 * through the app's retry policy first, and a test that asserts a refetch happened should not be
 * served the previous answer. The cache is per call, so no test can see another's data.
 *
 * The theme provider is here rather than per test because the nesting mirrors AppProviders:
 * anything in the shell may read the theme, and `useTheme` throws without it by design — a
 * component that silently fell back to the default theme would be a worse bug than a loud one. It
 * holds no cross-test state: each render reads localStorage fresh, and jsdom gives every file its
 * own.
 *
 * The tooltip provider is here for the same reason and with the same rule: Radix throws without
 * it, so any component that labels an icon button needs it in scope, and mirroring the real
 * nesting here means a test never has to know which of them does.
 */
export function renderWithQuery(ui: ReactNode): RenderResult & { client: QueryClient } {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  // As `wrapper` rather than around `ui`, so `rerender` keeps the providers — and with them the
  // cache — when a test re-renders after changing what a hook like `useSearchParams` returns.
  const Providers = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const result: RenderResult = render(ui, { wrapper: Providers });
  return { client, ...result };
}
