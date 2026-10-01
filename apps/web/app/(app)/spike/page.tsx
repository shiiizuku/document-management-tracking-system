/*
 * F0 style-isolation probe. Three things have to be true for the rebuild to proceed:
 *   1. Tailwind utilities compile and apply here.
 *   2. The brand tokens ported from globals.css resolve, so shadcn components will inherit them.
 *   3. Tailwind's preflight is active on THIS route but does not reach the legacy `/` route.
 * The bare <h2>/<ul> below are the preflight tell: unstyled here (no margin, no bullets), while `/`
 * keeps its own typography. Delete this route once F1 starts.
 */
const swatches = [
  ['--dts-ink', 'ink'],
  ['--dts-muted', 'muted'],
  ['--dts-paper', 'paper'],
  ['--dts-line', 'line'],
  ['--dts-green', 'green'],
  ['--dts-green2', 'green2'],
  ['--dts-pale', 'pale'],
  ['--dts-gold', 'gold'],
  ['--dts-danger', 'danger'],
] as const;

export default function SpikePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm tracking-widest text-muted-foreground uppercase">F0 probe</p>
      <h1 className="font-serif text-4xl text-foreground">
        Tailwind is isolated from the legacy CSS
      </h1>
      <p className="mt-2 text-muted-foreground">
        Compare this against{' '}
        <a className="text-primary underline" href="/">
          the legacy route
        </a>
        . Both render in one app; neither restyles the other.
      </p>

      <h2 className="mt-8 font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Brand tokens
      </h2>
      <ul className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5">
        {swatches.map(([token, label]) => (
          <li key={token} className="rounded-md border border-border bg-card p-2">
            <span
              className="block h-8 rounded-sm border border-border"
              style={{ background: `var(${token})` }}
            />
            <code className="mt-1 block text-[11px] text-muted-foreground">{label}</code>
          </li>
        ))}
      </ul>

      <h2 className="mt-8 font-sans text-xs font-semibold tracking-widest text-muted-foreground uppercase">
        Semantic aliases
      </h2>
      <div className="mt-3 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
            Primary
          </button>
          <button className="rounded-md bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground">
            Secondary
          </button>
          <button className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
            Destructive
          </button>
          <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
            Accent
          </span>
        </div>
        <label className="mt-4 block text-sm text-foreground">
          Focus ring uses --ring
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Search title, number, sender…"
          />
        </label>
      </div>
    </main>
  );
}
