import * as React from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FIELD_ICON, FIELD_ICON_PADDING, fieldClasses, type FieldSize } from './field-styles';

/*
 * A date input draws its own calendar icon, like a select draws its chevron, because the browser's
 * indicator differs per engine and ignores the field's inset. The native indicator is not removed:
 * it is made transparent and stretched 44px wide over the drawn icon, so a click on the icon still
 * opens the browser's own picker and the field stays fully keyboard-operable.
 */
const DATE_INDICATOR = cn(
  FIELD_ICON_PADDING,
  '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0',
  '[&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full',
  '[&::-webkit-calendar-picker-indicator]:w-11 [&::-webkit-calendar-picker-indicator]:cursor-pointer',
  '[&::-webkit-calendar-picker-indicator]:opacity-0',
);

function Input({
  className,
  type,
  fieldSize = 'form',
  ...props
}: React.ComponentProps<'input'> & { fieldSize?: FieldSize }) {
  const input = (
    <input
      type={type}
      data-slot="input"
      data-field-size={fieldSize}
      className={fieldClasses(
        fieldSize,
        cn(
          'selection:bg-primary selection:text-primary-foreground',
          'file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
          type === 'date' && cn('relative', DATE_INDICATOR),
          className,
        ),
      )}
      {...props}
    />
  );
  if (type !== 'date') return input;
  return (
    <div data-slot="date-input" className="relative w-full min-w-0">
      {input}
      <Calendar className={FIELD_ICON} aria-hidden />
    </div>
  );
}

export { Input };
