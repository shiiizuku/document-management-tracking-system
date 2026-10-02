import type { Metadata } from 'next';
import './theme.css';
import { AppProviders } from '@/components/app-providers';
import { appearanceBootScript } from '@/components/md3/appearance-config';

/*
 * The one layout above everything: the brand stylesheet, and the query cache, session-expiry
 * handling and toast surface that every screen needs in scope.
 *
 * It was deliberately empty during the rebuild, while the retired bespoke stylesheet still had to
 * be kept away from Tailwind's preflight. With that sheet gone there is one design system, so the
 * transitional wrapper group it needed is gone too.
 *
 * Mounting the providers here rather than per route group is what lets the query cache survive the
 * navigation out of /login: `useLogin` seeds the session from the login response, and a provider
 * torn down on the way into the app would throw it away and make the shell wait on a second
 * /auth/me.
 */
export const metadata: Metadata = {
  title: 'Document Tracking System',
  description: 'Secure document registration, routing, and accountability.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /*
     * `suppressHydrationWarning` is required, not cosmetic: the boot script below writes
     * `data-theme` / `data-accent` / `data-density` onto this element before React hydrates, so the
     * client's <html> attributes legitimately differ from the server's. The warning is scoped to
     * this element only and does not reach anything inside it.
     */
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Inlined and blocking, on purpose. It is the only way to have the user's theme on the
          first paint rather than one frame after it: the choice lives in localStorage, which the
          server cannot read, so anything that waits for React has already shown the wrong colours.
          It is a fixed string we author here — no user input reaches it.
        */}
        <script dangerouslySetInnerHTML={{ __html: appearanceBootScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
