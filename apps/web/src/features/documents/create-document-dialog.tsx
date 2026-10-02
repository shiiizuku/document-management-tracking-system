'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  createDocumentSchema,
  documentDirectionSchema,
  documentPrioritySchema,
  type CreateDocumentInput,
} from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
  FormDescription,
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
import { useUploadAttachmentToDocument } from '@/features/attachments/queries';
import { useDivisions, useSections } from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { applyServerErrors } from '@/lib/forms';
import { dueDateToIso, isoToDueDate } from './due-date';
import { DOCUMENT_TYPES, useCreateDocument } from './queries';

/** Radix cannot hold `''` as a select value, and "no section" is a real choice. */
const NO_SECTION = '__none__';

/**
 * Registers a new document.
 *
 * `createDocumentSchema` is the server's own schema, so the conditional rule it carries — an
 * incoming document must name a sender — is enforced here by the same code that enforces it at
 * the API, rather than by a second copy that can drift out of step with it.
 *
 * On success it goes straight to the new record. The tracking number is assigned by the server
 * and is the thing the user needs next, whether to write it on the physical document or to attach
 * the scan.
 */

/**
 * What the form holds, which is not what the API receives: the schema defaults `confidential`, so
 * it is optional going in and guaranteed coming out. `useForm`'s third type argument is the
 * post-validation shape, which is what the submit handler is given.
 */
type CreateFormValues = z.input<typeof createDocumentSchema>;
export function CreateDocumentDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { user } = useSession();
  const create = useCreateDocument();
  const [formError, setFormError] = useState<string | null>(null);
  /*
   * Files chosen before the document exists. Plain `File` objects held in state, not uploaded:
   * there is nothing to upload them to until the server assigns an id, and a temporary document
   * to hold them would be a row that has to be cleaned up when the user presses Cancel.
   */
  const [staged, setStaged] = useState<File[]>([]);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const uploadToDocument = useUploadAttachmentToDocument();
  const busy = create.isPending || uploadingIndex !== null;

  const form = useForm<CreateFormValues, unknown, CreateDocumentInput>({
    resolver: zodResolver(createDocumentSchema),
    defaultValues: {
      title: '',
      type: 'MEMORANDUM',
      priority: 'NORMAL',
      direction: 'INCOMING',
      divisionId: user?.divisionId ?? '',
      description: '',
      sender: '',
      company: '',
      referenceNumber: '',
    },
  });

  const divisions = useDivisions();
  const divisionId = form.watch('divisionId');
  const sections = useSections(divisionId || null);
  const direction = form.watch('direction');

  // Default to the user's own division once the list arrives, or to the only one there is. Doing
  // it here rather than in `defaultValues` is what covers the case where the session resolved
  // after the form was constructed.
  useEffect(() => {
    if (divisionId) return;
    const fallback = user?.divisionId ?? divisions.data?.[0]?.id;
    if (fallback) form.setValue('divisionId', fallback);
  }, [divisionId, divisions.data, form, user]);

  /*
   * Register, then upload, then go.
   *
   * Attachments cannot be posted before the document exists — the endpoint is
   * `/documents/:id/attachments` and the id is assigned by the server — so files picked here are
   * held in component state and sent once the record comes back.
   *
   * The two halves fail differently, and it matters. A failed CREATE means nothing happened: the
   * dialog stays open with the server's field errors on it. A failed UPLOAD means the document is
   * already registered and has a tracking number, so unwinding is not an option and pretending
   * otherwise would be worse — the record is reported as created, the files that did not attach
   * are named, and the user lands on the record where the Upload control is waiting. That is why
   * this awaits each upload rather than firing them in parallel: the first failure is reported
   * with the filename that caused it, not as one opaque rejection out of five.
   */
  const onSubmit = async (values: CreateDocumentInput) => {
    setFormError(null);

    let document: Awaited<ReturnType<typeof create.mutateAsync>>;
    try {
      document = await create.mutateAsync(values);
    } catch (error) {
      setFormError(applyServerErrors(form, error));
      return;
    }

    const failed: string[] = [];
    for (const [index, file] of staged.entries()) {
      setUploadingIndex(index);
      try {
        await uploadToDocument.mutateAsync({ documentId: document.id, file });
      } catch {
        failed.push(file.name);
      }
    }
    setUploadingIndex(null);

    setOpen(false);
    form.reset();
    setStaged([]);

    if (failed.length === 0) {
      toast.success(`Registered ${document.trackingNumber}`, { description: document.title });
    } else {
      toast.warning(`Registered ${document.trackingNumber}, but some files did not attach`, {
        description: `${failed.join(', ')} — upload ${failed.length === 1 ? 'it' : 'them'} again from the record.`,
      });
    }
    router.push(`/documents/${document.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Register document
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="gap-0.5">
          <p className="eyebrow">New registry entry</p>
          <DialogTitle>Register document</DialogTitle>
          <DialogDescription>
            The tracking number is assigned on save and cannot be chosen.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          {/*
            Three columns, not two. Nine of the eleven fields are a short select or a one-line
            input, and at two columns each of those claimed half the dialog's width while using a
            fraction of it — the form ran well past a screen for no reason. Grouped by what a clerk
            holds in mind at once: what the document IS, where it GOES, who it is FROM.
          */}
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-3 sm:grid-cols-3">
            {formError === null ? null : (
              <Alert variant="destructive" className="sm:col-span-3">
                <AlertCircle />
                <AlertTitle>Could not register this document</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="sm:col-span-3">
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
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Direction</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {documentDirectionSchema.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option === 'INCOMING' ? 'Incoming' : 'Outgoing'}
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
              name="divisionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Division</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      // The chosen section belongs to the old division and would be rejected.
                      form.setValue('sectionId', undefined);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a division" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(divisions.data ?? []).map((division) => (
                        <SelectItem key={division.id} value={division.id}>
                          {division.name}
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
              name="sectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) =>
                      field.onChange(value === NO_SECTION ? undefined : value)
                    }
                    disabled={(sections.data ?? []).length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>
                        {(sections.data ?? []).length === 0
                          ? 'No sections'
                          : 'Division-level (no section)'}
                      </SelectItem>
                      {(sections.data ?? []).map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
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
              name="dueAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target date (optional)</FormLabel>
                  <FormControl>
                    {/*
                      A day in, an instant out. The contract types `dueAt` as a datetime, but the
                      deadline a clerk sets is a date, so `dueDateToIso` pins it to the end of that
                      day — see features/documents/due-date.ts for why the end rather than the start.
                    */}
                    <Input
                      type="date"
                      value={isoToDueDate(field.value)}
                      onChange={(event) => field.onChange(dueDateToIso(event.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
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
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  {direction === 'INCOMING' ? (
                    <FormDescription>Required for an incoming document.</FormDescription>
                  ) : null}
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
                    <Input {...field} value={field.value ?? ''} />
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
                  <FormLabel>Email address (optional)</FormLabel>
                  <FormControl>
                    {/*
                      `type="email"` for the keyboard it brings up on a phone and for the browser's
                      own hint; the contract validates it properly either way, because a type
                      attribute is a convenience and not a check.
                    */}
                    <Input
                      type="email"
                      autoComplete="off"
                      placeholder="sender@agency.gov.ph"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormDescription>Where replies about this document should go.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="sm:col-span-3">
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormItem className="sm:col-span-3">
              <FormLabel htmlFor="register-attachments">Attachments (optional)</FormLabel>
              <StagedFiles
                id="register-attachments"
                files={staged}
                onAdd={(added) => setStaged((current) => [...current, ...added])}
                onRemove={(index) => setStaged((current) => current.filter((_, i) => i !== index))}
                disabled={busy}
              />
              <FormDescription>
                Files upload once the record exists and the tracking number is assigned.
              </FormDescription>
            </FormItem>

            <DialogFooter className="sm:col-span-3">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {uploadingIndex === null
                  ? 'Register document'
                  : `Uploading ${uploadingIndex + 1} of ${staged.length}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** Bytes as a person reads them. Base-10 units, because that is what a file manager shows. */
const fileSize = (bytes: number): string => {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['kB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

/**
 * The file picker for registration: choose files now, uploaded after the record is created.
 *
 * A list the user can remove from rather than a bare `<input multiple>`, because the native
 * control REPLACES its selection on every use — picking a second file after the first would
 * silently drop the first. Appending to our own array and clearing the input is what makes
 * "choose files" mean add, and what makes picking the same filename twice fire a change event
 * at all.
 */
function StagedFiles({
  id,
  files,
  onAdd,
  onRemove,
  disabled,
}: Readonly<{
  id: string;
  files: readonly File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  disabled: boolean;
}>) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const picked = Array.from(event.target.files ?? []);
          if (picked.length > 0) onAdd(picked);
          event.target.value = '';
        }}
      />
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Paperclip aria-hidden />
          Choose files
        </Button>
      </div>

      {files.length === 0 ? null : (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${String(file.lastModified)}`}
              className="flex items-center gap-2 rounded-md3-sm border border-border px-2 py-1.5"
            >
              <Paperclip className="size-4 shrink-0 text-on-surface-variant" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-body-small">{file.name}</span>
              <span className="shrink-0 text-label-small text-on-surface-variant">
                {fileSize(file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => onRemove(index)}
              >
                <X aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
