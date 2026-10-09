import * as React from 'react';
import { cn } from '@/lib/utils';
import { fieldClasses, type FieldSize } from './field-styles';

/*
 * A date input keeps the browser's own calendar indicator and draws none of its own. A drawn icon
 * can only sit over the native one where the engine lets the native one be hidden — WebKit/Blink
 * expose `::-webkit-calendar-picker-indicator`, Firefox exposes nothing — so in Firefox the field
 * showed two calendars. The native indicator is muted until hovered; `color-scheme` in theme.css
 * already draws it light in dark mode.
 */
const DATE_INDICATOR = cn(
  '[&::-webkit-calendar-picker-indicator]:cursor-pointer',
  '[&::-webkit-calendar-picker-indicator]:opacity-60',
  '[&::-webkit-calendar-picker-indicator]:hover:opacity-100',
);

function Input({
  className,
  type,
  fieldSize = 'form',
  ...props
}: React.ComponentProps<'input'> & { fieldSize?: FieldSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-field-size={fieldSize}
      className={fieldClasses(
        fieldSize,
        cn(
          'selection:bg-primary selection:text-primary-foreground',
          'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          type === 'date' && DATE_INDICATOR,
          className,
        ),
      )}
      {...props}
    />
  );
}

export { Input };
