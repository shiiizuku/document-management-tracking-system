import { Suspense } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, Check, Clock3, Route, ShieldCheck } from 'lucide-react';
import { LoginForm } from '@/features/session/login-form';
import { ThemeToggle } from '@/components/theme-toggle';
import { LandingMotion } from '@/features/public/landing-motion';

/*
 * The public entry point is deliberately more expressive than the authenticated workspace. It can
 * explain the product with editorial pacing and motion; records, forms and workflow actions stay
 * quiet and task focused once a user signs in. Everything on this page is still server rendered.
 * `LandingMotion` is a small progressive-enhancement island and never owns content or navigation.
 */

const ROUTE = [
  {
    step: '01',
    action: 'Register',
    office: 'Records Section',
    detail: 'Scan, classify and stamp every item with one permanent tracking number.',
  },
  {
    step: '02',
    action: 'Route',
    office: 'Divisions',
    detail: 'Move work desk to desk with an acknowledged, time-stamped chain of custody.',
  },
  {
    step: '03',
    action: 'Act',
    office: 'Regional Director',
    detail: 'Review, sign and version the official record without overwriting its history.',
  },
  {
    step: '04',
    action: 'Release',
    office: 'Records archive',
    detail: 'Close the loop while the complete trail stays searchable and accountable.',
  },
] as const;

const STORY =
  'A document should never disappear between offices. DTS makes custody visible, action explicit and every handoff part of one authoritative record.';

export default function LandingPage() {
  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <LandingMotion />

      <header className="sticky top-0 z-40 px-3 pt-3 sm:px-6" data-landing-nav>
        <nav className="mx-auto flex max-w-[1380px] items-center gap-3 rounded-2xl border border-border/80 bg-card/92 px-4 py-3 shadow-[0_14px_40px_rgb(0_0_0/0.08)] backdrop-blur-xl sm:px-5">
          <Image
            src="/branding/mgb-logo-160.png"
            alt="Mines and Geosciences Bureau seal"
            width={160}
            height={160}
            className="size-10 shrink-0 object-contain"
            priority
          />
          <div className="mr-auto min-w-0 leading-tight">
            <span className="block truncate text-[11px] font-bold tracking-[0.16em] text-seal-foreground uppercase">
              MGB Region III
            </span>
            <span className="block truncate text-sm font-semibold sm:text-[15px]">
              Document Tracking System
            </span>
          </div>
          <a
            href="#journey"
            className="hidden min-h-10 items-center rounded-xl px-3.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none md:inline-flex"
          >
            How it works
          </a>
          <Link
            href="/request-account"
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-primary/30 bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
          >
            Request access
            <ArrowRight className="hidden size-4 sm:block" aria-hidden />
          </Link>
        </nav>
      </header>

      <main className="w-full max-w-full overflow-x-hidden">
        <section className="relative mx-auto grid min-h-[calc(100svh-84px)] max-w-[1380px] grid-cols-1 items-center gap-12 px-6 py-20 lg:grid-cols-12 lg:gap-8 lg:py-28">
          <div
            className="pointer-events-none absolute top-1/2 -left-48 size-[36rem] -translate-y-1/2 rounded-full bg-primary/8 blur-[110px]"
            aria-hidden
            data-landing-orbit
          />

          <div className="relative min-w-0 lg:col-span-7" data-hero-copy>
            <p className="mb-7 max-w-xl text-sm font-semibold tracking-[0.08em] text-seal-foreground uppercase">
              One record. Every office. A complete trail.
            </p>
            <h1 className="max-w-6xl font-display text-[clamp(3.75rem,7.6vw,7.25rem)] leading-[0.88] font-normal tracking-[-0.055em] text-balance">
              Every handoff,
              <br />
              <em className="text-seal-foreground">accounted for.</em>
            </h1>
            <p className="mt-8 max-w-[680px] text-[clamp(1.05rem,1.7vw,1.35rem)] leading-relaxed text-foreground-secondary">
              A secure records workspace for Central Luzon—built to show where a document is, who
              has it and what must happen next.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <a
                href="#sign-in"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary px-5 text-[15px] font-semibold text-primary-foreground shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:bg-primary-hover hover:shadow-lg focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
              >
                Sign in securely
                <ArrowDownRight className="size-4" aria-hidden />
              </a>
              <Link
                href="/request-account"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-input bg-card px-5 text-[15px] font-semibold text-foreground shadow-xs transition-[transform,box-shadow] hover:-translate-y-0.5 hover:bg-accent hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
              >
                Request an account
              </Link>
            </div>
          </div>

          <div
            id="sign-in"
            data-slot="landing-sign-in"
            data-landing-sign-in
            className="relative scroll-mt-28 lg:col-span-5 lg:pl-8"
          >
            <div className="absolute -inset-5 -z-10 rounded-[2rem] border border-seal/20 bg-seal-tint/45 [transform:rotate(2deg)]" />
            <div className="rounded-[1.5rem] border bg-card p-6 shadow-[0_28px_80px_rgb(0_0_0/0.14)] sm:p-8">
              <Suspense fallback={<div className="h-96" />}>
                <LoginForm autoFocus={false} />
              </Suspense>
            </div>
          </div>
        </section>

        <div className="border-y border-border/70 bg-card py-4" aria-hidden>
          <div className="landing-marquee-track flex w-max items-center gap-8 whitespace-nowrap text-xs font-bold tracking-[0.18em] text-muted-foreground uppercase">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-8">
                {['Register', 'Route', 'Acknowledge', 'Act', 'Release', 'Archive'].map((label) => (
                  <span key={`${copy}-${label}`} className="flex items-center gap-8">
                    {label}
                    <span className="size-1.5 rounded-full bg-seal" />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <section id="journey" className="mx-auto max-w-[1380px] px-6 py-32 md:py-44">
          <div className="mb-14 grid gap-6 md:grid-cols-12 md:items-end">
            <h2 className="max-w-5xl font-display text-[clamp(2.75rem,5vw,5rem)] leading-[0.98] tracking-[-0.035em] text-balance md:col-span-8">
              One visible journey
              <span className="mx-2 inline-flex h-10 w-20 translate-y-1 items-center justify-center overflow-hidden rounded-full border bg-card align-middle shadow-sm sm:h-12 sm:w-24">
                <Image
                  src="/branding/mgb-logo-160.png"
                  alt=""
                  width={160}
                  height={160}
                  className="size-9 object-contain sm:size-10"
                />
              </span>
              from intake to archive.
            </h2>
            <p className="max-w-md text-base leading-relaxed text-muted-foreground md:col-span-4">
              Each office sees the same record, the same custody trail and the same next authorized
              action.
            </p>
          </div>

          <ol className="landing-route flex flex-col gap-3 lg:h-[410px] lg:flex-row" data-reveal>
            {ROUTE.map((stop, index) => (
              <li
                key={stop.step}
                data-route-item
                className="group relative min-h-64 overflow-hidden rounded-[1.5rem] border bg-card p-6 transition-[flex-grow,transform,box-shadow] duration-700 ease-out hover:-translate-y-1 hover:shadow-xl lg:min-h-0"
              >
                <div
                  className="absolute inset-0 opacity-0 transition-opacity duration-700 group-hover:opacity-100"
                  style={{
                    background:
                      index === ROUTE.length - 1
                        ? 'radial-gradient(circle at 85% 15%, color-mix(in oklch, var(--primary) 24%, transparent), transparent 48%)'
                        : 'radial-gradient(circle at 85% 15%, color-mix(in oklch, var(--seal) 26%, transparent), transparent 48%)',
                  }}
                  aria-hidden
                />
                <div className="relative flex h-full min-w-[210px] flex-col">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-sm font-semibold text-seal-foreground">
                      {stop.step}
                    </span>
                    <Route className="size-5 text-muted-foreground" aria-hidden />
                  </div>
                  <div className="mt-auto pt-14">
                    <p className="text-xs font-bold tracking-[0.14em] text-primary uppercase">
                      {stop.action}
                    </p>
                    <h3 className="mt-2 max-w-sm font-display text-3xl leading-tight">
                      {stop.office}
                    </h3>
                    <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted-foreground opacity-100 transition-opacity duration-500 lg:opacity-70 lg:group-hover:opacity-100">
                      {stop.detail}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-y border-border/70 bg-secondary/65">
          <div className="mx-auto max-w-[1380px] px-6 py-32 md:py-44">
            <p className="mx-auto max-w-5xl text-center font-display text-[clamp(2.6rem,5.2vw,5.3rem)] leading-[1.03] tracking-[-0.035em] text-balance">
              {STORY.split(' ').map((word, index) => (
                <span key={`${word}-${index}`} data-story-word className="inline-block">
                  {word}&nbsp;
                </span>
              ))}
            </p>

            <div
              className="mt-24 grid grid-flow-dense grid-cols-1 gap-4 md:grid-cols-12"
              data-reveal-grid
            >
              <article className="group relative min-h-[420px] overflow-hidden rounded-[1.75rem] bg-sidebar p-7 text-sidebar-foreground md:col-span-7 md:row-span-2 md:p-10">
                <div
                  className="absolute -right-24 -bottom-24 size-96 rounded-full border border-sidebar-border"
                  aria-hidden
                />
                <div
                  className="absolute -right-8 -bottom-8 size-64 rounded-full border border-sidebar-border"
                  aria-hidden
                />
                <Image
                  src="/branding/mgb-logo-160.png"
                  alt=""
                  width={160}
                  height={160}
                  data-ledger-seal
                  className="absolute right-8 bottom-8 size-28 object-contain opacity-70 sm:size-36"
                />
                <div className="relative max-w-lg">
                  <ShieldCheck className="size-7 text-sidebar-seal" aria-hidden />
                  <h3 className="mt-8 font-display text-[clamp(2.6rem,4.5vw,4.75rem)] leading-[0.98] tracking-[-0.035em]">
                    Accountability without the noise.
                  </h3>
                  <p className="mt-6 max-w-md text-base leading-relaxed text-sidebar-muted-foreground">
                    The interface keeps the record, its custodian and the next authorized action
                    ahead of the chrome around them.
                  </p>
                </div>
              </article>

              <article className="group min-h-[202px] overflow-hidden rounded-[1.75rem] border bg-card p-7 transition-[transform,box-shadow] duration-700 hover:-translate-y-1 hover:shadow-xl md:col-span-5">
                <Clock3
                  className="size-6 text-seal-foreground transition-transform duration-700 group-hover:scale-110"
                  aria-hidden
                />
                <h3 className="mt-8 font-display text-3xl">Time becomes evidence.</h3>
                <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">
                  Receipts, acknowledgements and actions remain ordered in one durable timeline.
                </p>
              </article>

              <article className="group min-h-[202px] overflow-hidden rounded-[1.75rem] border bg-card p-7 transition-[transform,box-shadow] duration-700 hover:-translate-y-1 hover:shadow-xl md:col-span-5">
                <Check
                  className="size-6 text-primary transition-transform duration-700 group-hover:scale-110"
                  aria-hidden
                />
                <h3 className="mt-8 font-display text-3xl">The next move is clear.</h3>
                <p className="mt-3 max-w-md leading-relaxed text-muted-foreground">
                  Role-aware actions help staff act confidently without exposing controls they
                  cannot use.
                </p>
              </article>

              {[
                ['Searchable', 'Find records by title, number, sender or current custodian.'],
                ['Traceable', 'See where a document came from and every office it crossed.'],
                ['Accessible', 'Keyboard-first controls, visible focus and semantic status cues.'],
              ].map(([title, detail]) => (
                <article
                  key={title}
                  className="min-h-[190px] rounded-[1.5rem] border bg-card p-7 md:col-span-4"
                >
                  <h3 className="font-display text-2xl">{title}</h3>
                  <p className="mt-4 leading-relaxed text-muted-foreground">{detail}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1380px] px-6 py-32 md:py-44" data-reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-primary px-7 py-14 text-primary-foreground sm:px-12 sm:py-16 lg:flex lg:items-end lg:justify-between lg:gap-12">
            <div
              className="pointer-events-none absolute -top-32 -right-20 size-96 rounded-full border border-primary-foreground/20"
              aria-hidden
            />
            <div className="relative max-w-4xl">
              <h2 className="font-display text-[clamp(3rem,6vw,6rem)] leading-[0.92] tracking-[-0.04em] text-balance">
                Put every document on the record.
              </h2>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-primary-foreground/80">
                Sign in with your organization-issued account, or request access from your DTS
                administrator.
              </p>
            </div>
            <div className="relative mt-9 flex shrink-0 flex-wrap gap-3 lg:mt-0">
              <a
                href="#sign-in"
                className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-primary-foreground px-5 font-semibold text-primary shadow-sm transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50 focus-visible:outline-none"
              >
                Sign in
                <ArrowRight className="size-4" aria-hidden />
              </a>
              <Link
                href="/request-account"
                className="inline-flex min-h-12 items-center rounded-xl border border-primary-foreground/45 px-5 font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10 focus-visible:ring-[3px] focus-visible:ring-primary-foreground/50 focus-visible:outline-none"
              >
                Request access
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1380px] flex-wrap items-center justify-between gap-5 px-6 py-8 text-[13px] text-muted-foreground">
          <span>Mines and Geosciences Bureau · Region III, Central Luzon</span>
          <span>Authorized use only. Every action is recorded.</span>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
