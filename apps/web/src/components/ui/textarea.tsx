import * as React from 'react';
import { cn } from '@/lib/utils';

/** Form-size text field, grown to its content: same border, inset and focus as `Input`. */
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-24 w-full rounded-xl border-[1.5px] border-input bg-card px-3.5 py-3 text-base text-foreground',
        'transition-[color,border-color] outline-none placeholder:text-muted-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-2 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
