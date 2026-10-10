import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { ThemeToggle } from '@/components/theme-toggle';

interface PublicAccessShellProps {
  eyebrow: string;
  title: string;
  description: string;
  points: readonly string[];
  action: { href: string; label: string };
  children: ReactNode;
}

/** Shared, server-rendered frame for the two public account entry points. */
export function PublicAccessShell({
  eyebrow,
  title,
  description,
  points,
  action,
  children,
}: Readonly<PublicAccessShellProps>) {
  return (
    <main className="route-enter min-h-[100dvh] bg-background p-3 text-foreground sm:p-4">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] max-w-[1480px] overflow-hidden rounded-[24px] border bg-card shadow-[0_24px_80px_color-mix(in_oklch,var(--foreground)_10%,transparent)] lg:grid-cols-12">
        <section className="relative flex min-h-[420px] flex-col overflow-hidden bg-sidebar p-6 text-sidebar-foreground sm:p-9 lg:col-span-7 lg:min-h-0 lg:p-12 xl:p-16">
          <div
            className="pointer-events-none absolute -top-44 -right-28 size-[34rem] rounded-full border border-sidebar-border/80"
            aria-hidden
          />
          <div
            className="pointer-events-none absolute -top-24 -right-8 size-[22rem] rounded-full border border-sidebar-border/70"
            aria-hidden
          />

          <div className="relative flex items-center justify-between gap-4">
            <Link
              href="/"
              className="flex min-w-0 items-center gap-3 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-sidebar-seal focus-visible:ring-offset-[3px] focus-visible:ring-offset-sidebar"
            >
              <Image
                src="/branding/mgb-logo-160.png"
                alt="Mines and Geosciences Bureau seal"
                width={160}
                height={160}
                className="size-11 shrink-0 object-contain"
                priority
              />
              <span className="min-w-0 leading-tight">
                <span className="block truncate text-[11px] font-bold tracking-[0.14em] text-sidebar-seal uppercase">
                  MGB Region III
                </span>
                <span className="block truncate text-sm font-semibold sm:text-[15px]">
                  Document Tracking System
                </span>
              </span>
            </Link>
            <Link
              href={action.href}
              className="hidden min-h-11 shrink-0 items-center rounded-[10px] border border-sidebar-border px-4 text-sm font-semibold text-sidebar-foreground transition-[background-color,transform] hover:bg-sidebar-accent active:translate-y-px focus-visible:ring-2 focus-visible:ring-sidebar-seal focus-visible:ring-offset-[3px] focus-visible:ring-offset-sidebar focus-visible:outline-none sm:inline-flex"
            >
              {action.label}
            </Link>
          </div>

          <div className="relative my-auto max-w-3xl py-14 lg:py-20">
            <p className="text-xs font-bold tracking-[0.16em] text-sidebar-seal uppercase">
              {eyebrow}
            </p>
            <h1 className="mt-5 max-w-4xl font-display text-[clamp(3rem,6.2vw,6.8rem)] leading-[0.94] font-normal tracking-[-0.045em] text-balance">
              {title}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-sidebar-muted-foreground sm:text-lg">
              {description}
            </p>
          </div>

          <ul className="relative grid gap-3 border-t border-sidebar-border pt-6 sm:grid-cols-3">
            {points.map((point) => (
              <li key={point} className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4 shrink-0 text-sidebar-seal" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </section>

        <section className="relative grid bg-background lg:col-span-5">
          <div className="absolute top-5 right-5 z-10">
            <ThemeToggle />
          </div>
          <div className="grid place-items-center px-6 py-24 sm:px-10 lg:px-12 xl:px-16">
            <div data-slot="public-form" className="w-full max-w-[460px]">
              {children}
            </div>
          </div>
          <p className="absolute right-6 bottom-5 left-6 text-center text-xs leading-relaxed text-muted-foreground">
            Authorized use only. Activity is recorded in the audit trail.
          </p>
        </section>
      </div>
    </main>
  );
}
