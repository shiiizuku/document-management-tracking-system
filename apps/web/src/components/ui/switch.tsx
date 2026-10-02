'use client';

import * as React from 'react';
import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * The MD3 switch.
 *
 * Material's switch is not shadcn's with different colours — the proportions carry the meaning.
 * The track is 52x32 with a 2px inset, and the handle CHANGES SIZE as it moves: 16px when off,
 * 24px when on. That growth is the affordance. A switch whose handle is one size reads as a
 * decorative toggle; one that swells into the on position reads as something that committed.
 *
 * The off state is `surface-container-highest` inside a 2px `outline` border, which is what keeps
 * an unchecked switch legible on a card — a borderless grey track at these proportions disappears
 * against `surface-container-high`. On, the border goes transparent, the track takes `primary` and
 * the handle takes `primary-container`, which is MD3's own pairing and keeps the handle readable
 * against the track it sits on rather than relying on the shadow a flat design does not cast.
 *
 * `icon` renders inside the handle. MD3 allows an icon on the selected state (and optionally on
 * both); passing one is how this stops being a colour-only signal — WCAG 1.4.1 — which matters
 * more here than usual, because a theme switch's two states look alike to anyone who cannot see
 * the colour that distinguishes them.
 */
function Switch({
  className,
  icon,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & { icon?: React.ReactNode }) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-8 w-[3.25rem] shrink-0 items-center rounded-full border-2 p-0.5',
        'transition-[background-color,border-color] duration-(--md-duration-short-4) ease-standard',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:pointer-events-none disabled:opacity-[0.38]',
        'data-[state=unchecked]:border-outline data-[state=unchecked]:bg-surface-container-highest',
        'data-[state=checked]:border-transparent data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          'pointer-events-none flex items-center justify-center rounded-full',
          /*
           * Size, colour and travel all animate together on the emphasized curve — this is a
           * control the user aimed at, not ambient movement. The unchecked handle is centred in
           * its 16px box by the 4px inset, so the smaller circle does not sit against the edge.
           */
          'transition-[width,height,transform,background-color] duration-(--md-duration-medium-1) ease-emphasized',
          /*
           * The travel is 20px, not 24px, and the arithmetic is worth writing down because it is
           * what was wrong: the track is 52px wide BORDER-box, so the 2px border and the 2px
           * padding take 8px off each axis and leave a 44x24 well. A 24px handle inside a 44px
           * well can move 20px, and asking it for 24 pushed it into the border.
           *
           * Off, the 16px handle sits 4px into the well — 8px from the outside of the track, which
           * is MD3's own inset. On, the 24px handle fills the well's height and lands 4px from the
           * far edge.
           */
          'data-[state=unchecked]:size-4 data-[state=unchecked]:translate-x-1 data-[state=unchecked]:bg-outline',
          'data-[state=checked]:size-6 data-[state=checked]:translate-x-5 data-[state=checked]:bg-primary-container',
          '[&_svg]:size-4 [&_svg]:shrink-0 data-[state=unchecked]:[&_svg]:hidden',
          '[&_svg]:text-on-primary-container',
        )}
      >
        {icon}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  );
}

export { Switch };
