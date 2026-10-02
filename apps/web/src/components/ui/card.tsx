import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/*
 * MD3 card, on shadcn's API.
 *
 * The slot names, the grid behaviour of CardHeader and the `card-action` corner all survive, so
 * every existing call site keeps working. What changed is the thing MD3 is most opinionated about:
 *
 *   stock shadcn:  bg-card + border + shadow-sm
 *   MD3:           a surface container tone, and no shadow at all
 *
 * A card is a raised container, and MD3 raises it by TONE — the default `filled` variant sits on
 * `surface-container-high`, two steps above the page's `surface-container-low`. Those two steps are
 * what separate it; a shadow on top would be saying the same thing twice, and saying it in the one
 * register that does not survive dark mode (a drop shadow against a near-black surface is
 * invisible, which is exactly why MD3 moved to tone).
 *
 * The three variants are MD3's three, and they are an emphasis scale, not a style menu:
 *   filled    — the default. Grouped content, several per screen. Level 0, separated by tone.
 *   elevated  — one card that must read as floating above the rest. Level 1 + the lightest shadow.
 *   outlined  — the quietest. Level 0, no fill, a hairline. For a card inside another card, where
 *               another tone step would run out of scale.
 *
 * Padding and gaps read the density tokens, so `<html data-density="minimal">` tightens every card
 * in the app without a prop.
 */
const cardVariants = cva(
  [
    'flex flex-col',
    'gap-card-gap py-card',
    // MD3 shape: `lg` (16px) at default density, stepping down with it — a 12px-padded card with a
    // 16px radius looks like a bubble, so the two move together.
    'rounded-[var(--md-density-card-radius)]',
    'text-card-foreground',
    // Cards are a cross-fade target when the user changes accent, mode or density. Colour only.
    'transition-[background-color,border-color,box-shadow] duration-medium-1 ease-standard',
  ],
  {
    variants: {
      variant: {
        /*
         * `bg-card` resolves to `surface-container-high` through the bridge in md3-theme.css. It is
         * written as `bg-card` rather than `bg-surface-container-high` so that a component pasted
         * in from the shadcn registry — which will say `bg-card` — lands on the same tone with no
         * edit. That indirection is the whole point of the bridge.
         */
        filled: 'bg-card',

        // Level 1 is a 5% primary mix in light and 8% in dark; the shadow pair catches the edge.
        elevated: 'bg-elevation-1 shadow-md3-1',

        // `outline-variant` (tone 80), not `outline` (tone 50): this is a container edge, not an
        // affordance. Tone 50 here turns a list of cards into a grid of boxes.
        outlined: 'border border-outline-variant bg-surface',
      },
    },
    defaultVariants: {
      variant: 'filled',
    },
  },
);

function Card({
  className,
  variant = 'filled',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(cardVariants({ variant, className }))}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        '@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-card has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-card',
        className,
      )}
      {...props}
    />
  );
}

/*
 * title-medium (16/500), not MD3's title-large (22/400).
 *
 * The spec's card title assumes a content card with room to breathe; this app's cards are dense
 * panels in a document queue, several to a screen, and 22px titles inside a 16px-padded panel read
 * as a stack of competing headlines. title-medium is the role MD3 itself uses for a list item's
 * leading line, which is what these actually are. Pass `className="text-title-large"` for the one
 * hero card where the spec size is right.
 */
function CardTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-title"
      className={cn('text-title-medium leading-none', className)}
      {...props}
    />
  );
}

/* body-medium on `on-surface-variant` — MD3's supporting-text pair. */
function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-body-medium text-on-surface-variant', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('px-card', className)} {...props} />;
}

/*
 * Buttons in a card footer are `tonal` or `ghost`, never `default` — MD3 reserves the filled button
 * for the single highest-emphasis action on a screen, and a screen of cards each with a filled
 * button has no highest-emphasis action at all. The footer does not enforce this; it is the rule a
 * reviewer should hold the call sites to.
 */
function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center gap-2 px-card [.border-t]:pt-card', className)}
      {...props}
    />
  );
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardVariants,
};
