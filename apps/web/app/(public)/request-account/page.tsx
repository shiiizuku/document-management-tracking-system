import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { RequestAccountForm } from '@/features/admin/request-account-form';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Request an account · Document Tracking System',
};

/*
 * The public application form, in the same frame as the landing page: the seal header, the form
 * in a card beside a short statement of how access is decided, and the shared footer.
 *
 * A server component, so everything but the form is prerendered. No Suspense boundary: this form
 * reads nothing from the URL.
 */
export default function RequestAccountPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-3.5 px-6 py-3.5">
          <Link href="/" className="mr-auto flex items-center gap-3.5">
            <Image
              src="/branding/mgb-logo-160.png"
              alt="Mines and Geosciences Bureau seal"
              width={160}
              height={160}
              className="size-11 shrink-0 object-contain"
              priority
            />
            <span className="flex flex-col leading-tight">
              <span className="eyebrow">MGB Region III</span>
              <span className="text-[15px] font-semibold">Document Tracking System</span>
            </span>
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center rounded-xl border bg-card px-4 text-sm font-medium shadow-xs transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:outline-none"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1240px] flex-wrap items-start gap-12 px-6 pt-[72px] pb-20">
        <div className="min-w-0 flex-[1_1_480px]">
          <span className="inline-flex h-7 items-center gap-2 rounded-full bg-seal-tint px-3 text-[13px] font-semibold text-seal-foreground">
            <span className="size-1.5 rounded-full bg-seal" aria-hidden />
            Government records operations
          </span>
          <h1 className="mt-5 font-display text-[clamp(3rem,7vw,4.75rem)] leading-none font-normal">
            Access is granted,
            <br />
            <em className="text-seal-foreground">never assumed.</em>
          </h1>
          <p className="mt-7 max-w-[520px] text-lg leading-relaxed text-foreground-secondary">
            Every account is reviewed by an administrator, who decides the role it holds and the
            part of the organization it can reach. Nothing is granted by default.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2 text-[13px]">
            {['Reviewed by a person', 'Least privilege', 'Decision recorded'].map((claim) => (
              <li key={claim} className="rounded-full border bg-card px-3 py-1">
                {claim}
              </li>
            ))}
          </ul>
        </div>

        <div
          data-slot="public-form"
          className="w-full min-w-0 flex-[0_1_440px] rounded-xl border bg-card p-6 shadow-sm"
        >
          <RequestAccountForm />
        </div>
      </main>

      <footer className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-3 px-6 pt-7 pb-8 text-[13px] text-muted-foreground">
        <span>Mines and Geosciences Bureau · Region III, Central Luzon</span>
        <span>Authorized use only. Every action is recorded.</span>
        <ThemeToggle />
      </footer>
    </div>
  );
}
