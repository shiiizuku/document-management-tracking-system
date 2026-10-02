import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

/*
 * MD3 button, on shadcn's API.
 *
 * Every variant and size name the app already calls is still here and still means the same thing,
 * so this is a restyle and not a migration: `default` is MD3's filled button, `secondary` is filled
 * tonal, `outline` is outlined, `ghost` is the text button, `destructive` is filled-on-error. Three
 * new variants (`tonal`, `elevated`, `tertiary`) are additive.
 *
 * Four things changed from stock shadcn, and each is a spec rule rather than a taste call:
 *
 * 1. SHAPE. `rounded-full`, not `rounded-md`. MD3's button is a pill at every size, including the
 *    icon buttons — which become circles rather than squircles.
 *
 * 2. STATE. The per-variant `hover:bg-primary/90` is gone, replaced by one `md3-state-layer` class.
 *    The layer is a pseudo-element tinted with the button's own `currentColor` at the spec opacity
 *    (hover 8%, focus and pressed 10%), so a filled button's overlay is on-primary and a text
 *    button's is primary without either knowing about the other. That is also what makes the nine
 *    accent presets work: no variant has a hardcoded hover colour to re-derive.
 *
 * 3. ELEVATION. No `shadow-xs` on the outlined variant. In MD3 an outlined button is at level 0 and
 *    its border IS its separation; only `elevated` lifts, and it lifts with a tonal surface
 *    (`bg-elevation-1`) plus the lightest shadow pair, not with `shadow-md`.
 *
 * 4. DISABLED. Not `opacity-50`. Fading the element fades its background too, so a disabled filled
 *    button sitting on a tinted card lets the card show through it. MD3 instead sets the container
 *    to on-surface at 12% and the label to on-surface at 38%, both fully opaque.
 *
 * The default size reads the density tokens (`h-control`, `px-control`) rather than a literal
 * height, so `<html data-density="compact">` retunes it with no prop and no conditional. The named
 * sizes stay literal on purpose: a toolbar that asked for `sm` wants `sm`.
 */
const buttonVariants = cva(
  [
    'md3-state-layer',
    'inline-flex shrink-0 items-center justify-center whitespace-nowrap',
    // The pill. MD3's shape scale puts every button at `full`.
    'rounded-full',
    // label-large: 14px / 500 / 0.1px tracking. `text-sm` would carry none of that.
    'text-label-large',
    // Only colour and transform animate; never size, or a row of buttons reflows on hover.
    // `standard` is the curve for a state change the user did not aim anywhere specific.
    'transition-[color,background-color,border-color,box-shadow] duration-(--md-duration-short-2) ease-standard',
    // The base stylesheet owns `:focus-visible`, so there is one focus treatment app-wide instead
    // of a ring here and an outline elsewhere. The state layer brightens at 10% alongside it.
    'outline-none',
    'disabled:pointer-events-none',
    'aria-invalid:border-error aria-invalid:text-on-error-container',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[1.125rem]",
  ],
  {
    variants: {
      variant: {
        // MD3 filled — the one high-emphasis button on a screen.
        default:
          'bg-primary text-primary-foreground disabled:bg-on-surface/12 disabled:text-on-surface/38',

        // MD3 filled tonal — medium emphasis. The secondary container is the lower-attention
        // filled button, which is what shadcn's `secondary` was always reaching for.
        secondary:
          'bg-secondary-container text-on-secondary-container disabled:bg-on-surface/12 disabled:text-on-surface/38',
        tonal:
          'bg-secondary-container text-on-secondary-container disabled:bg-on-surface/12 disabled:text-on-surface/38',

        // The accent preset's second colour. For a parallel action that should not read as the
        // primary one — "Export" next to "Submit".
        tertiary:
          'bg-tertiary-container text-on-tertiary-container disabled:bg-on-surface/12 disabled:text-on-surface/38',

        // MD3 outlined. Border at `outline` (tone 50), not `outline-variant` — here the border is
        // the affordance, so it takes the tone that clears 3:1 against the surface on its own.
        outline:
          'border border-outline bg-transparent text-primary disabled:border-on-surface/12 disabled:text-on-surface/38',

        // MD3 text button. No container at all until the state layer appears.
        ghost: 'bg-transparent text-primary disabled:text-on-surface/38',

        // MD3 elevated. The only variant that lifts, and it lifts tonally first: the shadow pair is
        // there to catch the edge, not to do the separating.
        elevated:
          'bg-elevation-1 text-primary shadow-md3-1 hover:shadow-md3-2 active:shadow-md3-1 disabled:bg-on-surface/12 disabled:text-on-surface/38 disabled:shadow-none',

        // Filled, on the error palette. The error palette is pinned and never follows the accent
        // preset — a user-chosen hue must not be able to make a destructive action read as safe.
        destructive: 'bg-error text-on-error disabled:bg-on-surface/12 disabled:text-on-surface/38',

        // Not an MD3 button. Kept because an inline text link inside a sentence is not a control
        // and should not grow a pill; `md3-state-layer` is suppressed for the same reason.
        link: '[&::after]:hidden rounded-none bg-transparent text-primary underline-offset-4 hover:underline disabled:text-on-surface/38',
      },
      size: {
        // Density-driven. 40 / 36 / 32px at default / compact / minimal.
        default: 'h-control gap-control-gap px-control has-[>svg]:pl-4',
        xs: "h-6 gap-1 px-2.5 text-label-small [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-8 gap-1.5 px-3.5 text-label-medium',
        lg: "h-12 gap-2.5 px-6 text-title-medium [&_svg:not([class*='size-'])]:size-5",
        // Icon buttons are circles at every size — `rounded-full` on a square box.
        icon: 'size-control',
        'icon-xs': "size-6 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-8',
        'icon-lg': "size-12 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  /*
   * `asChild` is what keeps the Radix accessibility primitives intact through the restyle. A
   * DialogTrigger or DropdownMenuTrigger renders ITS element — carrying its own id, `aria-expanded`,
   * `aria-controls`, `aria-haspopup`, `data-state` and the focus management that goes with them —
   * and merges these classes onto it. The state layer reads `[data-state='open']`, so a trigger
   * stays lit while its menu is open without this component knowing a menu exists.
   */
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
