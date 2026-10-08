import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LoginForm } from '@/features/session/login-form';
import { ThemeToggle } from '@/components/theme-toggle';

/*
 * The landing page: what the system is, how a document travels through the office, and the
 * sign-in form, on one screen.
 *
 * A server component, so everything but the form is prerendered; the form is the only client code
 * on the route. It deliberately does not probe the session. A signed-out visitor is the normal
 * case here, and a 401 from the probe would be sent to /login by the QueryClient, bouncing the
 * landing page away. Someone already signed in simply signs in again, or opens the dashboard.
 *
 * `/login` stays as the dedicated sign-in screen: it is where an expired session is sent, with
 * `?next=` preserved, and the Suspense boundary below is required for the same reason it is there
 * (`LoginForm` reads `?next=` with `useSearchParams`).
 */

/** The route a document takes, in order. Release is the one stop that is not an office. */
const ROUTE = [
  {
    step: '01 · Intake',
    office: 'Records Section',
    detail: 'Registered, scanned and stamped with a tracking number.',
  },
  {
    step: '02 · Routing',
    office: 'Divisions',
    detail: 'Moved desk to desk; every receipt is acknowledged and timed.',
  },
  {
    step: '03 · Action',
    office: 'Office of the Regional Director',
    detail: 'Reviewed, signed, and versioned — nothing overwritten.',
  },
  {
    step: '04 · Release',
    office: 'Released & archived',
    detail: 'The trail stays, searchable and audited, long after release.',
  },
] as const;

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3.5 px-6 py-3.5">
          <Image
            src="/branding/mgb-logo-160.png"
            alt="Mines and Geosciences Bureau seal"
            width={160}
            height={160}
            className="size-11 shrink-0 object-contain"
            priority
          />
          <div className="mr-auto flex flex-col leading-tight">
            <span className="eyebrow">MGB Region III</span>
            <span className="text-[15px] font-semibold">Document Tracking System</span>
          </div>
          <Link
            href="/request-account"
            className="inline-flex h-10 items-center rounded-xl border bg-card px-4 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
          >
            Request access
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-12 px-6 pt-[72px] pb-20">
          <div className="min-w-0 flex-[1_1_560px]">
            <span className="inline-flex h-7 items-center gap-2 rounded-full bg-seal-tint px-3 text-[13px] font-semibold text-seal-foreground">
              <span className="size-1.5 rounded-full bg-seal" aria-hidden />
              Mines and Geosciences Bureau · Central Luzon
            </span>
            <h1 className="mt-5 font-display text-[clamp(3rem,7vw,4.75rem)] leading-none font-normal">
              Every handoff,
              <br />
              <em className="text-seal-foreground">accounted for.</em>
            </h1>
            <p className="mt-7 max-w-[520px] text-lg leading-relaxed text-foreground-secondary">
              From the Records Section to the Regional Director&apos;s desk and back out the door —
              one authoritative timeline for every communication, permit and report Central Luzon
              handles.
            </p>
          </div>

          <div
            data-slot="landing-sign-in"
            className="w-full min-w-0 flex-[0_1_400px] rounded-xl border bg-card p-6 shadow-sm"
          >
            <Suspense fallback={<div className="h-96" />}>
              <LoginForm autoFocus={false} />
            </Suspense>
          </div>
        </section>

        <section aria-labelledby="route-heading" className="border-y bg-secondary">
          <div className="mx-auto max-w-[1240px] px-6 pt-16 pb-[72px]">
            <h2 id="route-heading" className="eyebrow mb-8 text-muted-foreground">
              How a document travels
            </h2>
            <ol className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
              {ROUTE.map((stop, index) => {
                const last = index === ROUTE.length - 1;
                return (
                  <li
                    key={stop.step}
                    className={
                      last
                        ? 'flex flex-col gap-3 rounded-b-lg border border-t-[3px] border-t-primary bg-card p-5'
                        : 'flex flex-col gap-3 rounded-b-lg border border-t-[3px] border-t-seal bg-card p-5'
                    }
                  >
                    <span
                      className={
                        last
                          ? 'font-mono text-[13px] text-primary uppercase'
                          : 'font-mono text-[13px] text-seal-foreground uppercase'
                      }
                    >
                      {stop.step}
                    </span>
                    <span className="font-display text-2xl">{stop.office}</span>
                    <span className="text-[15px] leading-relaxed text-muted-foreground">
                      {stop.detail}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>
      </main>

      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-6 pt-7 pb-8 text-[13px] text-muted-foreground">
        <span>Mines and Geosciences Bureau · Region III, Central Luzon</span>
        <span>Authorized use only. Every action is recorded.</span>
        <ThemeToggle />
      </footer>
    </div>
  );
}
