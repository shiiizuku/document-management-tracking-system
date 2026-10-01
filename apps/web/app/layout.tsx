import type { Metadata } from 'next';

/*
 * The root layout deliberately imports NO stylesheet. During the rebuild two design systems
 * coexist — the legacy bespoke CSS and Tailwind — and a sheet imported here would load on every
 * route, letting Tailwind's preflight reset the legacy screens. Each route group imports its own:
 * (legacy) takes globals.css, (app) takes theme.css. See docs/frontend-rebuild-plan.md.
 */
export const metadata: Metadata = {
  title: 'Document Tracking System',
  description: 'Secure document registration, routing, and accountability.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
