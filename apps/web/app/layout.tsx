import type { Metadata } from 'next';
import './theme.css';
import { AppProviders } from '@/components/app-providers';

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
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
