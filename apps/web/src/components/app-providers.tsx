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
      */}
      <Toaster richColors closeButton position="bottom-right" />
    </QueryClientProvider>
  );
}
