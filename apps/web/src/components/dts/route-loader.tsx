import Image from 'next/image';
import { cn } from '@/lib/utils';

export function RouteLoader({
  title = 'Loading your workspace',
  detail = 'Preparing the latest authorized records.',
  overlay = false,
}: Readonly<{ title?: string; detail?: string; overlay?: boolean }>) {
  return (
    <div
      className={cn(
        'grid place-items-center bg-background text-foreground',
        overlay ? 'fixed inset-0 z-50 min-h-[100dvh] px-6' : 'min-h-[min(72dvh,720px)] w-full px-6',
      )}
      role="status"
      aria-live="polite"
      aria-label={title}
    >
      <div className="w-full max-w-sm text-center">
        <div className="route-loader-mark mx-auto grid size-20 place-items-center rounded-[20px] border bg-card shadow-[0_18px_50px_color-mix(in_oklch,var(--foreground)_10%,transparent)]">
          <Image
            src="/branding/mgb-logo-160.png"
            alt=""
            width={160}
            height={160}
            className="size-12 object-contain"
            priority={overlay}
          />
        </div>
        <p className="mt-7 font-display text-3xl leading-tight">{title}</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p>
        <div
          className="route-loader-lines mx-auto mt-8 flex w-44 items-center justify-center gap-2"
          aria-hidden
        >
          <span />
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
