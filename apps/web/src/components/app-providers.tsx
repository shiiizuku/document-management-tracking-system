'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { createQueryClient, loginRedirectTarget } from '../lib/query-client';
import { AppearanceProvider } from './md3/appearance';
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
      {/*
        Appearance sits inside the query provider but outside everything else: the theme must be
        readable by any screen, and it must not be torn down by the navigation out of /login — the
        user picks a density once, not once per route.
      */}
      <AppearanceProvider>
        {/*
          One tooltip provider for the app. Radix shares the open/close timing across everything
          under it, which is what makes a row of icon buttons behave like a row — the second
          tooltip opens immediately rather than each control waiting out its own delay.
        */}
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </AppearanceProvider>
      {/*
        Toasts are immediate feedback only. The durable record of anything that matters is the
        notification inbox (D-111), so nothing here is the sole copy of a message.

        Coloured from the MD3 roles rather than from sonner's own palette, which is a fixed
        light/dark pair sitting outside the theme: under the Sage accent its success green passes
        for ours by coincidence, and under Rose or Slate a green toast is simply the wrong app.

        Through sonner's **CSS variables**, not through `classNames`. The library injects its
        stylesheet at runtime, after the app's, so an attribute selector of equal specificity wins
        over a utility class and a `bg-*` className is silently ignored — which is the kind of
        failure that looks like a theming bug for a week. These variables are the seam it offers,
        and `richColors` is what makes it read the per-type ones.

        Error and warning take their own roles rather than the accent, deliberately: the one thing
        a toast's colour must carry is whether something failed, and a palette where a refusal
        looks like a confirmation is worse than one that ignores the theme.
      */}
      <Toaster
        richColors
        closeButton
        position="bottom-right"
        style={
          {
            '--normal-bg': 'var(--md-surface-container-high)',
            '--normal-text': 'var(--md-on-surface)',
            '--normal-border': 'var(--md-outline-variant)',
            '--success-bg': 'var(--md-primary-container)',
            '--success-text': 'var(--md-on-primary-container)',
            '--success-border': 'var(--md-outline-variant)',
            '--info-bg': 'var(--md-secondary-container)',
            '--info-text': 'var(--md-on-secondary-container)',
            '--info-border': 'var(--md-outline-variant)',
            '--warning-bg': 'var(--md-tertiary-container)',
            '--warning-text': 'var(--md-on-tertiary-container)',
            '--warning-border': 'var(--md-outline-variant)',
            '--error-bg': 'var(--md-error-container)',
            '--error-text': 'var(--md-on-error-container)',
            '--error-border': 'var(--md-outline-variant)',
          } as React.CSSProperties
        }
      />
    </QueryClientProvider>
  );
}
