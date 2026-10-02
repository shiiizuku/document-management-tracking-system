'use client';

import { useState } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { AlertCircle, History, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { documentPrioritySchema, updateDocumentMetadataSchema } from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { dueDateToIso, isoToDueDate } from './due-date';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { documentTypeLabel } from '@/components/dts/status-badge';
import { ApiError } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import {
  DOCUMENT_TYPES,
  useMetadataRevisions,
  useUpdateMetadata,
  type DocumentDetail,
} from './queries';

/**
 * The editable half of a document's metadata, plus the record of who changed what.
 *
 * Direction, division, section and status are absent on purpose, and not because they are hard:
 * direction and placement drive reference allocation and access scope, and status moves only
 * through the workflow actions. The server rejects all four here, so offering them would be an
 * input whose only outcome is an error.
 */

type MetadataFormValues = {
  title: string;
  type: string;
  description: string;
  priority: DocumentDetail['priority'];
  sender: string;
  company: string;
  referenceNumber: string;
  email: string;
  confidential: boolean;
  /** `YYYY-MM-DD` as the date input holds it, or `''` for no target date. */
  dueAt: string;
};

/** Empty text means "clear this field", which the API expresses as null rather than `''`. */
const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/**
 * Validates with the server's own patch schema rather than a second copy of its rules.
 *
 * The form cannot hand that schema to `zodResolver` directly: it holds `''` where the patch holds
 * `null`, and the patch carries an `expectedVersion` the user neither sees nor sets. So the values
 * are converted to the payload first and the payload is what gets parsed. The field names are the
 * same on both sides, which is what lets each issue land on the input that caused it.
 */
const metadataResolver =
  (expectedVersion: number): Resolver<MetadataFormValues> =>
  (values) => {
    const parsed = updateDocumentMetadataSchema.safeParse({ ...toPatch(values), expectedVersion });
    // RHF wants the form's own values back on success, not the parsed payload.
    if (parsed.success) return { values, errors: {} };

    const errors: Record<string, { type: string; message: string }> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      // `expectedVersion` is not an input, so an issue on it can only mean a bug here rather than
      // something the user can fix; the first issue per field wins, as RHF shows one message.
      if (typeof field !== 'string' || field === 'expectedVersion' || field in errors) continue;
      errors[field] = { type: issue.code, message: issue.message };
    }
    // One cast, at the boundary where a string-keyed record becomes RHF's field-keyed shape.
    return { values: {}, errors: errors as FieldErrors<MetadataFormValues> };
  };

export function MetadataDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const update = useUpdateMetadata(document.id);
  // Only fetched once the history is actually asked for: most edits never open it.
  const revisions = useMetadataRevisions(document.id, open && showHistory);

  const form = useForm<MetadataFormValues>({
    resolver: metadataResolver(document.version),
    defaultValues: {
      title: document.title,
      type: document.type,
      description: document.description ?? '',
      priority: document.priority,
      sender: document.sender ?? '',
      company: document.company ?? '',
      referenceNumber: document.referenceNumber ?? '',
      email: document.email ?? '',
      confidential: document.confidential,
      dueAt: isoToDueDate(document.dueAt),
    },
  });

  const onSubmit = (values: MetadataFormValues) => {
    setFormError(null);
    update.mutate(
      { ...toPatch(values), expectedVersion: document.version },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success('Metadata updated', {
            description: `The change is recorded against ${document.trackingNumber}.`,
          });
        },
        onError: (error) => {
          // The mutation already refetched the document, so the form is now showing values the
          // user may want to re-read before re-applying their edit.
          if (error instanceof ApiError && error.isConflict) {
            setFormError(
              'This document changed — review and retry. The latest values are shown behind this dialog.',
            );
            return;
          }
          setFormError(applyServerErrors(form, error));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil />
          Edit metadata
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <p className="eyebrow">{document.trackingNumber}</p>
          <DialogTitle>Edit metadata</DialogTitle>
          <DialogDescription>
            Every change is versioned and attributed. Direction, placement and status are changed
            elsewhere.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
            {formError === null ? null : (
              <Alert variant="destructive" className="sm:col-span-2">
                <AlertCircle />
                <AlertTitle>Could not save</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input maxLength={240} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {documentTypeLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {documentPrioritySchema.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sender</FormLabel>
                  <FormControl>
                    <Input maxLength={240} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company / agency</FormLabel>
                  <FormControl>
                    <Input maxLength={240} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="referenceNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>External reference</FormLabel>
                  <FormControl>
                    <Input maxLength={120} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email address</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      maxLength={240}
                      autoComplete="off"
                      placeholder="sender@agency.gov.ph"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={4} maxLength={5000} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dueAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target date</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confidential"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 sm:col-span-2">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                  <FormLabel className="font-normal">
                    Confidential — restricts this document to users cleared for it
                  </FormLabel>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="sm:col-span-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory((shown) => !shown)}
                className="mr-auto"
              >
                <History />
                {showHistory ? 'Hide revisions' : 'Revision history'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? <Loader2 className="animate-spin" /> : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>

        {showHistory ? (
          <section className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-foreground">Revision history</h3>
            {revisions.isPending ? (
              <p className="mt-2 text-sm text-muted-foreground">Loading revisions…</p>
            ) : (revisions.data ?? []).length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                This document has not been edited since registration.
              </p>
            ) : (
              <ol className="mt-2 space-y-3">
                {(revisions.data ?? []).map((revision) => (
                  <li key={revision.id} className="text-sm">
                    <time
                      dateTime={revision.occurredAt}
                      className="block text-xs text-muted-foreground"
                    >
                      {new Date(revision.occurredAt).toLocaleString()}
                    </time>
                    <ul className="mt-1 space-y-0.5">
                      {changedFields(revision.before, revision.after).map(({ field, from, to }) => (
                        <li key={field} className="text-muted-foreground">
                          <span className="font-medium text-foreground">{field}</span>: {from} →{' '}
                          {to}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Turns the form's text inputs back into the patch shape the API accepts. */
const toPatch = (values: MetadataFormValues) => ({
  title: values.title.trim(),
  type: values.type,
  description: orNull(values.description),
  priority: values.priority,
  sender: orNull(values.sender),
  company: orNull(values.company),
  referenceNumber: orNull(values.referenceNumber),
  email: orNull(values.email),
  confidential: values.confidential,
  // `null` clears the target date; an omitted field would leave the old one in place, and the
  // two mean different things to the patch schema.
  dueAt: dueDateToIso(values.dueAt) ?? null,
});

/**
 * The fields that actually differ between two revision snapshots.
 *
 * The server records a full before/after snapshot of every tracked field, so rendering it raw
 * would show a dozen unchanged values per edit and bury the one that moved.
 */
export const changedFields = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ field: string; from: string; to: string }> =>
  Object.keys(after)
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      field,
      from: describe(before[field]),
      to: describe(after[field]),
    }));

/**
 * Renders one snapshot value for the history list. A revision snapshot is `Record<string,
 * unknown>`, so anything could be in it; a non-primitive is JSON-encoded rather than stringified,
 * which would print `[object Object]` and tell the reader nothing about what changed.
 */
const describe = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value) ?? 'unknown';
};
