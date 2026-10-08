import type { Metadata } from 'next';
import { RequestAccountForm } from '@/features/admin/request-account-form';
import { ThemeToggle } from '@/components/theme-toggle';

export const metadata: Metadata = {
  title: 'Request an account · Document Tracking System',
};

/*
 * The public application form, in the same two-panel frame as sign-in.
 *
 * A server component, so the story half is prerendered and the form arrives as the only client code
 * on the route. No Suspense boundary here, unlike `/login`: this form reads nothing from the URL.
 */
export default function RequestAccountPage() {
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
          Access is
          <br />
          granted, never
          <br />
          <em>assumed.</em>
        </h1>
        <p className="mt-6 max-w-md text-sidebar-muted-foreground">
          Every account is reviewed by an administrator, who decides the role it holds and the part
          of the organization it can reach. Nothing is granted by default.
        </p>
        <ul className="mt-10 flex flex-wrap gap-2 text-xs">
          {['Reviewed by a person', 'Least privilege', 'Decision recorded'].map((claim) => (
            <li
              key={claim}
              className="rounded-full border border-sidebar-border px-3 py-1 text-sidebar-foreground"
            >
              {claim}
            </li>
          ))}
        </ul>
        <span
          className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-sidebar-accent/60"
          aria-hidden
        />
      </section>

      <section data-slot="public-form" className="grid place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <RequestAccountForm />
          <div className="mt-8">
            <ThemeToggle />
          </div>
        </div>
      </section>
    </main>
  );
}
