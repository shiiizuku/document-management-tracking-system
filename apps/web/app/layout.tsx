import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './theme.css';
import { AppProviders } from '@/components/app-providers';
import { themeBootScript } from '@/components/theme-storage';

/*
 * Inter, from two files committed under `app/fonts` (see the README beside them).
 *
 * `next/font/local` rather than a hand-written `@font-face`, because it emits the preload link and
 * the `font-display` for us and hashes the file into the build output — there is no `public/fonts`
 * URL to keep in step with a deploy. Both faces are declared as a weight *range*: one variable file
 * covers 100–900, so no weight the design asks for needs a second request.
 *
 * Two families rather than one, and composed as a fallback list in `theme.css`. `localFont` has no
 * per-file `unicode-range`, which is how a subsetted family is normally spelled, so the coverage is
 * expressed the other way round: the browser falls through to the next family per *glyph*, which
 * reaches the Latin Extended file only for text the Latin one cannot set. That file is therefore
 * `preload: false` — it is 85 kB against the Latin file's 48 kB, and almost nothing in a Philippine
 * records office needs it. Preloading both would double the font cost of first paint to buy glyphs
 * that are never drawn.
 */
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

const interExtended = localFont({
  src: './fonts/inter-latin-ext-variable.woff2',
  weight: '100 900',
  variable: '--font-inter-ext',
  display: 'swap',
  preload: false,
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
      className={`${inter.variable} ${interExtended.variable}`}
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
