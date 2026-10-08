'use client';

import { useId } from 'react';
import { useFieldArray, useFormContext } from 'react-hook-form';
import { Mail, Plus, X } from 'lucide-react';
import {
  DOCUMENT_RECIPIENT_LIMIT,
  RECIPIENT_EMAIL_LIMIT,
  type CreateDocumentInput,
} from '@dts/contracts';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useDebounced } from '@/lib/use-debounced';
import { useNameSuggestions } from './queries';

/**
 * A text input that offers names already used, as the browser's native suggestion list.
 *
 * A `<datalist>` rather than a custom combobox on purpose: it is keyboard- and screen-reader-
 * operable with no code of ours, it never traps focus inside a dialog, and free text stays the
 * default — a new correspondent is the normal case here, not an error to be corrected into an
 * existing name. `autoComplete="off"` is set so the browser's own saved-form history does not draw
 * a second list over this one.
 */
export function SuggestInput({
  kind,
  value,
  onChange,
  ...props
}: Readonly<
  Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange' | 'list' | 'autoComplete'> & {
    kind: 'sender' | 'recipient';
    value: string;
    onChange: (value: string) => void;
  }
>) {
  const listId = useId();
  const suggestions = useNameSuggestions(kind, useDebounced(value, 250));
  // Offering a name the field already holds exactly is noise.
  const options = (suggestions.data ?? []).filter((name) => name !== value);

  return (
    <>
      <Input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        list={listId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
    </>
  );
}

/**
 * The addressees of an outgoing document: one or more recipients, each a name and any number of
 * optional email addresses.
 *
 * Written against the register form's context rather than taking props, because every field in it
 * is a path into that one form. Emails are a plain array of strings, which `useFieldArray` cannot
 * hold (it needs objects), so they are read and written by path instead.
 */
export function RecipientsField({ disabled = false }: Readonly<{ disabled?: boolean }>) {
  const form = useFormContext<CreateDocumentInput>();
  const recipients = useFieldArray({ control: form.control, name: 'recipients' });
  const rootError = form.formState.errors.recipients?.root?.message;
  const listError = form.formState.errors.recipients?.message;

  return (
    <div className="space-y-2">
      <Label>Recipients</Label>
      <ul className="space-y-3">
        {recipients.fields.map((field, index) => (
          <RecipientRow
            key={field.id}
            index={index}
            canRemove={recipients.fields.length > 1}
            onRemove={() => recipients.remove(index)}
            disabled={disabled}
          />
        ))}
      </ul>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || recipients.fields.length >= DOCUMENT_RECIPIENT_LIMIT}
          onClick={() => recipients.append({ name: '', emails: [] })}
        >
          <Plus />
          Add recipient
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Who the document is addressed to. Email addresses are optional.
      </p>
      {(rootError ?? listError) === undefined ? null : (
        <p role="alert" className="text-sm text-destructive">
          {rootError ?? listError}
        </p>
      )}
    </div>
  );
}

function RecipientRow({
  index,
  canRemove,
  onRemove,
  disabled,
}: Readonly<{ index: number; canRemove: boolean; onRemove: () => void; disabled: boolean }>) {
  const form = useFormContext<CreateDocumentInput>();
  const nameError = form.formState.errors.recipients?.[index]?.name?.message;
  const emailErrors = form.formState.errors.recipients?.[index]?.emails;
  const name = form.watch(`recipients.${index}.name`) ?? '';
  const emails = form.watch(`recipients.${index}.emails`) ?? [];

  const setEmails = (next: string[]) =>
    form.setValue(`recipients.${index}.emails`, next, { shouldDirty: true });

  return (
    <li className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <SuggestInput
            kind="recipient"
            aria-label={`Recipient ${index + 1}`}
            placeholder="Person or agency"
            maxLength={240}
            disabled={disabled}
            value={name}
            onChange={(next) =>
              form.setValue(`recipients.${index}.name`, next, {
                shouldDirty: true,
                shouldValidate: nameError !== undefined,
              })
            }
          />
          {nameError === undefined ? null : (
            <p role="alert" className="text-sm text-destructive">
              {nameError}
            </p>
          )}
        </div>
        {canRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove recipient ${index + 1}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <X />
          </Button>
        ) : null}
      </div>

      {emails.map((address, emailIndex) => {
        const error = emailErrors?.[emailIndex]?.message;
        return (
          // The array has no stable id; a row is only ever appended or removed by its position.
          <div key={emailIndex} className="flex items-start gap-2 pl-4">
            <div className="min-w-0 flex-1 space-y-1">
              <Input
                type="email"
                inputMode="email"
                autoComplete="off"
                placeholder="name@agency.gov.ph"
                aria-label={`Email ${emailIndex + 1} for recipient ${index + 1}`}
                maxLength={240}
                disabled={disabled}
                value={address}
                onChange={(event) =>
                  setEmails(emails.map((item, i) => (i === emailIndex ? event.target.value : item)))
                }
              />
              {error === undefined ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove email ${emailIndex + 1} for recipient ${index + 1}`}
              disabled={disabled}
              onClick={() => setEmails(emails.filter((_, i) => i !== emailIndex))}
            >
              <X />
            </Button>
          </div>
        );
      })}

      <div className="pl-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || emails.length >= RECIPIENT_EMAIL_LIMIT}
          onClick={() => setEmails([...emails, ''])}
        >
          <Mail />
          Add email address
        </Button>
      </div>
    </li>
  );
}
