import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginForm } from '@/features/session/login-form';

export const metadata: Metadata = {
  title: 'Sign in · Document Tracking System',
};

/*
 * The sign-in screen, ported from the bespoke login shell it replaces: a green story panel that
 * says what the system is for, and the form beside it.
 *
 * A server component, so the story half is prerendered and the form arrives as the only client
 * code on the route. The Suspense boundary is required rather than decorative: `LoginForm` reads
 * `?next=` with `useSearchParams`, and Next refuses to prerender a client hook that depends on
 * URL data unless there is a boundary to fall back to.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.15fr_0.85fr]">
      <section className="relative hidden flex-col justify-center overflow-hidden bg-primary px-[8vw] py-16 text-primary-foreground lg:flex">
        {/* The seal. Decorative, so it is hidden from assistive technology. */}
        <span
          className="mb-10 flex size-16 items-center justify-center rounded-full border-2 border-gold/70 font-serif text-xl tracking-widest"
          aria-hidden
        >
          DTS
        </span>
        <p className="text-[11px] font-bold tracking-[0.14em] text-gold uppercase">
          Government records operations
        </p>
        <h1 className="mt-3 font-serif text-5xl leading-[1.08]">
          Every document.
          <br />
          Every handoff.
          <br />
          <em>Accounted for.</em>
        </h1>
        <p className="mt-6 max-w-md text-primary-foreground/80">
          Secure registration, routing, review, release, and archival—one authoritative timeline
          from intake to completion.
        </p>
        <ul className="mt-10 flex flex-wrap gap-2 text-xs">
          {['Immutable versions', 'Scoped access', 'Audited actions'].map((claim) => (
            <li
              key={claim}
              className="rounded-full border border-primary-foreground/25 px-3 py-1 text-primary-foreground/90"
            >
              {claim}
            </li>
          ))}
        </ul>
        {/* A soft highlight in the corner, matching the panel it replaces. */}
        <span
          className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-primary-foreground/5"
          aria-hidden
        />
      </section>

      <section className="grid place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <Suspense fallback={<div className="h-96" />}>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
