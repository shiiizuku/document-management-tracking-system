'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { createQueryClient, loginRedirectTarget } from '../lib/query-client';
import { ThemeProvider } from './theme-provider';
import { TooltipProvider } from './ui/tooltip';

/**
 * Everything the rebuilt routes need in scope: the query cache, the session-expiry response, and
 * the toast surface. Mounted once by the (app) layout.
 *
 * The policies live in lib/query-client; this only supplies the half that needs React — knowing
 * the current route and navigating away from it.
 */
export function AppProviders({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();

  // The client is built once per mount so a re-render never discards the cache. That means the
  // handler below closes over the FIRST render's pathname, which would send the user back to
  // wherever they started rather than where they were when the session died — hence the ref.
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const [client] = useState(() =>
    createQueryClient({
      onUnauthenticated: () => {
        const target = loginRedirectTarget(pathnameRef.current, window.location.search);
        if (!target) return;
        toast.error('Your session expired', { description: 'Sign in again to continue.' });
        router.push(target);
      },
    }),
  );

  return (
    <QueryClientProvider client={client}>
      {/* Keep theme state across route changes. */}
      <ThemeProvider>
        {/*
          One tooltip provider for the app. Radix shares the open/close timing across everything
          under it, which is what makes a row of icon buttons behave like a row — the second
          tooltip opens immediately rather than each control waiting out its own delay.
        */}
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </ThemeProvider>
      {/* Toasts use the same semantic and status colors as the rest of the app. */}
      <Toaster
        richColors
        closeButton
        position="bottom-right"
        style={
          {
            '--normal-bg': 'var(--popover)',
            '--normal-text': 'var(--popover-foreground)',
            '--normal-border': 'var(--border)',
            '--success-bg': 'var(--signal-done)',
            '--success-text': 'var(--on-signal-done)',
            '--success-border': 'var(--border)',
            '--info-bg': 'var(--signal-move)',
            '--info-text': 'var(--on-signal-move)',
            '--info-border': 'var(--border)',
            '--warning-bg': 'var(--signal-wait)',
            '--warning-text': 'var(--on-signal-wait)',
            '--warning-border': 'var(--border)',
            '--error-bg': 'var(--destructive)',
            '--error-text': '#fff',
            '--error-border': 'var(--border)',
          } as React.CSSProperties
        }
      />
    </QueryClientProvider>
  );
}
