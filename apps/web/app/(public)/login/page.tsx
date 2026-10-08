import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/features/session/login-form';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Sign in · Document Tracking System',
};

/*
 * The sign-in screen: a story panel in the theme's sidebar colour that says what the system is
 * for, and the form beside it.
 *
 * A server component, so the story half is prerendered and the form arrives as the only client
 * code on the route. The Suspense boundary is required rather than decorative: `LoginForm` reads
 * `?next=` with `useSearchParams`, and Next refuses to prerender a client hook that depends on
 * URL data unless there is a boundary to fall back to.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_0.85fr]">
      <section
        data-slot="public-story"
        className="relative hidden flex-col justify-center overflow-hidden bg-sidebar px-[8vw] py-16 text-sidebar-foreground lg:flex"
      >
        {/* The seal. Decorative, so it is hidden from assistive technology. */}
        <span
          className="mb-10 flex size-16 items-center justify-center rounded-full border-2 border-sidebar-seal font-display text-xl tracking-widest text-sidebar-seal"
          aria-hidden
        >
          DTS
        </span>
        <p className="text-xs font-bold tracking-[0.16em] text-sidebar-seal uppercase">
          Government records operations
        </p>
        <h1 className="mt-3 font-display text-5xl leading-[1.08] font-normal">
          Every handoff,
          <br />
          <em>accounted for.</em>
        </h1>
        <p className="mt-6 max-w-md text-sidebar-muted-foreground">
          Secure registration, routing, review, release, and archival—one authoritative timeline
          from intake to completion.
        </p>
        <ul className="mt-10 flex flex-wrap gap-2 text-xs">
          {['Immutable versions', 'Scoped access', 'Audited actions'].map((claim) => (
            <li
              key={claim}
              className="rounded-full border border-sidebar-border px-3 py-1 text-sidebar-foreground"
            >
              {claim}
            </li>
          ))}
        </ul>
        {/* A soft highlight in the corner, matching the panel it replaces. */}
        <span
          className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-sidebar-accent/60"
          aria-hidden
        />
      </section>

      <section data-slot="public-form" className="grid place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <Suspense fallback={<div className="h-96" />}>
            <LoginForm />
          </Suspense>
          <div className="mt-8">
            <ThemeToggle />
          </div>
        </div>
      </section>
    </main>
  );
}
