import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './theme.css';
import { AppProviders } from '@/components/app-providers';
import { themeBootScript } from '@/components/theme-storage';

/*
 * Public Sans (UI and body) and Newsreader (display), each one variable woff2 committed under
 * `app/fonts` (see the README beside them for where they came from and how they were subset).
 *
 * `next/font/local` rather than a hand-written `@font-face`, because it emits the preload link and
 * the `font-display` for us and hashes the file into the build output — there is no `public/fonts`
 * URL to keep in step with a deploy. Both are declared as a weight *range*: one variable file
 * covers every weight, so no weight the design asks for needs a second request.
 *
 * One file per family, Latin and Latin Extended together. Inter needed two because its Latin
 * Extended half doubled the download; here the whole subset of Public Sans is 34 kB. Newsreader is
 * the heavier file (about 190 kB, most of it the optical-size axis that keeps 44px titles from
 * looking like enlarged body text) and is still preloaded, because a page title is above the fold
 * on every signed-in screen and swapping it late is the most visible flash the app could have.
 */
const publicSans = localFont({
  src: './fonts/public-sans-variable.woff2',
  weight: '100 900',
  variable: '--font-public-sans',
  display: 'swap',
});

const newsreader = localFont({
  src: './fonts/newsreader-variable.woff2',
  weight: '200 800',
  variable: '--font-newsreader',
  display: 'swap',
});

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
     * `suppressHydrationWarning` is required, not cosmetic: the boot script below writes a dark
     * class and `data-theme` onto this element before React hydrates, so the client's <html>
     * attributes can differ from the server's. The warning is scoped to this element only and does
     * not reach anything inside it.
     */
    <html
      lang="en"
      className={`${publicSans.variable} ${newsreader.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Inlined and blocking, on purpose. It is the only way to have the user's theme on the
          first paint rather than one frame after it: the choice lives in localStorage, which the
          server cannot read, so anything that waits for React has already shown the wrong colours.
          It is a fixed string we author (in `theme-storage.ts`, beside the provider that shares
          its keys) — no user input reaches it.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
