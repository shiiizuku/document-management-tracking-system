import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

/*
 * Civic Ledger buttons. Every size a pointer is expected to hit is at least 44px tall (`xs` and
 * `icon-xs` are the deliberate exceptions, for controls inside a dense row that already has a
 * larger target around it). `sm` and `icon-sm` therefore differ from the defaults in padding and
 * type size, not height.
 *
 * Focus is a 2px seal ring with a 3px gap in the page colour, rather than shadcn's translucent
 * ring: the gap keeps the ring legible against a primary fill of nearly any theme.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] text-[15px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-seal focus-visible:ring-offset-[3px] focus-visible:ring-offset-background disabled:pointer-events-none aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-muted disabled:text-muted-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-accent disabled:bg-muted disabled:text-muted-foreground',
        outline:
          'border-[1.5px] border-primary bg-transparent text-primary hover:bg-accent disabled:border-border disabled:text-muted-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground disabled:opacity-50',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 disabled:bg-muted disabled:text-muted-foreground dark:text-background',
        link: 'text-foreground underline underline-offset-4 hover:text-primary disabled:opacity-50',
      },
      size: {
        default: 'h-11 px-5 has-[>svg]:px-4',
        xs: 'h-8 gap-1 rounded-md px-2 text-xs [&_svg:not([class*="size-"])]:size-3',
        sm: 'h-11 gap-1.5 px-3.5 text-sm',
        lg: 'h-12 px-6',
        icon: 'size-11',
        'icon-xs': 'size-8 rounded-md [&_svg:not([class*="size-"])]:size-3.5',
        'icon-sm': 'size-11',
        'icon-lg': 'size-12',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
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
