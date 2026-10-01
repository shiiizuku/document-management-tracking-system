import type { Metadata } from 'next';
import { RequestAccountForm } from '@/features/admin/request-account-form';

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
          Access is
          <br />
          granted, never
          <br />
          <em>assumed.</em>
        </h1>
        <p className="mt-6 max-w-md text-primary-foreground/80">
          Every account is reviewed by an administrator, who decides the role it holds and the part
          of the organization it can reach. Nothing is granted by default.
        </p>
        <ul className="mt-10 flex flex-wrap gap-2 text-xs">
          {['Reviewed by a person', 'Least privilege', 'Decision recorded'].map((claim) => (
            <li
              key={claim}
              className="rounded-full border border-primary-foreground/25 px-3 py-1 text-primary-foreground/90"
            >
              {claim}
            </li>
          ))}
        </ul>
        <span
          className="pointer-events-none absolute -right-24 -bottom-24 size-80 rounded-full bg-primary-foreground/5"
          aria-hidden
        />
      </section>

      <section className="grid place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <RequestAccountForm />
        </div>
      </section>
    </main>
  );
}
