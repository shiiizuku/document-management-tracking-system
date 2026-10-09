'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ChevronRight, Loader2, Paperclip, Plus, X } from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
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
import { ConfirmDialog } from '@/components/dts/confirm-dialog';
import { useUploadAttachmentToDocument } from '@/features/attachments/queries';
import {
  useDivisions,
  useDocumentTypes,
  useHeadOfBureau,
  useOfferedDocumentTypes,
  useSections,
} from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { dueDateToIso, isoToDueDate } from './due-date';
import { useCreateDocument } from './queries';
import { RecipientsField, SuggestInput } from './recipients-field';

/** "Name, Title", tolerating a blank name and a setting that has not loaded yet. */
const senderLabel = (head: { name?: string; title?: string } | undefined): string =>
  [head?.name ?? '', head?.title ?? 'Head of the Bureau']
    .filter((part) => part.trim() !== '')
    .join(', ');

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
/**
 * The server's schema plus the one rule that only the form can usefully state up front: an
 * outgoing document needs someone to be addressed to. The API accepts an empty list (older records
 * and integrations have none), so the requirement lives here rather than in the shared contract.
 */
const createFormSchema = createDocumentSchema.superRefine((value, context) => {
  if (value.direction === 'OUTGOING' && value.recipients.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['recipients'],
      message: 'Add at least one recipient',
    });
  }
});
type CreateFormValues = z.input<typeof createFormSchema>;

const withoutBlankEmails = (values: CreateFormValues): CreateFormValues => ({
  ...values,
  recipients: values.recipients?.map((recipient) => ({
    ...recipient,
    emails: recipient.emails?.filter((address) => address.trim() !== ''),
  })),
});
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
    // An email row left empty is "none", not an invalid address: it is dropped before validation.
    resolver: (values, context, options) =>
      zodResolver(createFormSchema)(withoutBlankEmails(values), context, options),
    defaultValues: {
      title: '',
      type: 'MEMORANDUM',
      priority: 'NORMAL',
      direction: 'INCOMING',
      divisionId: user?.divisionId ?? '',
      description: '',
      sender: '',
      recipients: [],
      company: '',
      /*
       * These three live in a collapsed panel, so they are not mounted when the form first
       * renders — and `applyServerErrors` only attaches to names it finds in `getValues()`, which
       * reads the registered fields plus these defaults. Leaving them out meant a server error on
       * `email` could not be attached to the input, so it fell through to the form-level alert and
       * the panel holding the offending field never opened.
       */
      email: '',
      // Mounted only for incoming documents (decision 168), so it is defaulted here for the same
      // reason as the three above: `applyServerErrors` only attaches to names it can find.
      referenceNumber: '',
      sectionId: undefined,
      dueAt: undefined,
    },
  });

  /*
   * Which collapsed panel is the reason the form will not submit.
   *
   * Read from RHF's error map rather than tracked by hand, so it covers both halves: a client-side
   * rule from the shared schema, and a field error the server sent back through
   * `applyServerErrors`. Without it a rejected email sits in a shut panel and the dialog looks
   * broken — it refuses to save and shows nothing.
   */
  const { errors } = form.formState;
  const hasDetailErrors = Boolean(
    errors.priority ?? errors.sectionId ?? errors.dueAt ?? errors.company ?? errors.email,
  );
  const hasContentErrors = Boolean(errors.description);

  const divisions = useDivisions();
  const divisionId = form.watch('divisionId');
  // Decision 168: the sender's reference belongs to an incoming letter and has no meaning on an
  // outgoing one, whose reference the server allocates (decision 169).
  const incoming = form.watch('direction') === 'INCOMING';
  const headOfBureau = useHeadOfBureau();
  const senderValue = form.watch('sender') ?? '';
  const recipientCount = form.watch('recipients')?.length ?? 0;

  /*
   * One blank recipient row appears when a document becomes outgoing, so the field is there to be
   * typed into, and the list is emptied when it becomes incoming — an incoming document has no
   * recipients, and a leftover blank row would fail validation for a field nobody can see.
   */
  useEffect(() => {
    if (!incoming && recipientCount === 0) form.setValue('recipients', [{ name: '', emails: [] }]);
    if (incoming && recipientCount > 0) form.setValue('recipients', []);
  }, [incoming, recipientCount, form]);
  const sections = useSections(divisionId || null);

  // Default to the user's own division once the list arrives, or to the only one there is. Doing
  // it here rather than in `defaultValues` is what covers the case where the session resolved
  // after the form was constructed.
  /*
   * `MEMORANDUM` is the default because it is what most mail is, but an administrator can retire
   * it. Once the list is known, a default it no longer offers moves to the first type it does.
   */
  const documentTypes = useDocumentTypes();
  const type = form.watch('type');
  // The current value stands in only while the list loads; a failed load blocks registration
  // instead, rather than filing everything under a default nobody chose.
  const typeOptions = useOfferedDocumentTypes(documentTypes.isPending ? type : undefined);
  const typesFailed = documentTypes.isError;
  useEffect(() => {
    const offered = documentTypes.data?.filter((option) => option.active);
    if (offered === undefined || offered.some((option) => option.code === type)) return;
    const first = offered[0];
    if (first) form.setValue('type', first.code);
  }, [documentTypes.data, type, form]);

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
  /*
   * Registering writes a tracking number that goes on paper, so a valid form is held and read back
   * to the clerk first. Only the confirm button runs the submit.
   */
  const [pending, setPending] = useState<CreateDocumentInput | null>(null);

  const onSubmit = async (values: CreateDocumentInput) => {
    setPending(null);
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
      <DialogContent className="max-h-[90vh] gap-3 overflow-y-auto sm:max-w-xl">
        <DialogHeader className="gap-0.5">
          <p className="eyebrow">New registry entry</p>
          <DialogTitle>Register document</DialogTitle>
          <DialogDescription>
            The tracking number is assigned on save and cannot be chosen.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => setPending(values))}
            className="flex flex-col gap-3"
          >
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not register this document</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {/*
              Essentials first. These five are what it takes to file something: everything else
              either has a sensible default (priority is Normal, placement is the division the
              clerk belongs to) or is genuinely optional, and putting all eleven on screen made the
              common case look as demanding as the rare one.
            */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input maxLength={240} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-3 sm:grid-cols-3 [&>*]:min-w-0">
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
                        {typeOptions.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {typesFailed ? (
                      <p role="alert" className="text-sm text-destructive">
                        Document types could not be loaded.{' '}
                        <button
                          type="button"
                          className="underline"
                          onClick={() => void documentTypes.refetch()}
                        >
                          Try again
                        </button>
                      </p>
                    ) : null}
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
            </div>

            {incoming ? (
              <FormField
                control={form.control}
                name="sender"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sender</FormLabel>
                    <FormControl>
                      <SuggestInput
                        kind="sender"
                        name={field.name}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        maxLength={240}
                        value={senderValue}
                        onChange={field.onChange}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <>
                {/*
                  An outgoing document is always sent in the Head of the Bureau's name, so the
                  sender is shown and not asked for. The server sets it from the office settings
                  whatever this form sends; showing it here is what lets the clerk see it.
                */}
                <FormItem>
                  <FormLabel htmlFor="register-sender">Sender</FormLabel>
                  <Input
                    id="register-sender"
                    readOnly
                    value={headOfBureau.data === undefined ? '' : senderLabel(headOfBureau.data)}
                  />
                  <FormDescription>
                    Outgoing documents are always sent by the Head of the Bureau.
                  </FormDescription>
                </FormItem>
                <RecipientsField disabled={busy} />
              </>
            )}

            {/*
              Subject is on the form, not folded into an optional panel. It is the line the bureau's
              routing slip prints under "Subject" and the line a colleague reads when a document
              reaches them, so a record registered without one is a record nobody can identify from
              its slip — whatever the schema says about the column being nullable.
            */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Subject</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>What the document is about, in a line or two.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/*
              Beside the sender, not folded away with the optional details. It is the string a
              reply is matched against the letter by, so it is transcribed off the paper at the
              moment the rest of the letter is — which is exactly what decision 168 is about: it
              used to be addable only after registration, by reopening the record.
            */}
            {incoming ? (
              <FormField
                control={form.control}
                name="referenceNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Sender&rsquo;s reference</FormLabel>
                    <FormControl>
                      <Input maxLength={120} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormDescription>
                      The reference the sending office printed on their letter, if there is one.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/*
              The rest, folded away. `defaultOpen` is driven by whether anything inside is in
              error, which is the part that cannot be left out: a server-rejected email in a
              collapsed panel is a form that refuses to submit and will not say why.
            */}
            <OptionalSection
              title="More details"
              summary={
                incoming
                  ? 'Priority, section, target date, company, email'
                  : 'Priority, section, target date, company'
              }
              hasError={hasDetailErrors}
            >
              {/*
                Two across, not three. At the dialog's width three columns leave the Section select
                about 150px, which is narrower than "Division-level (no section)" — and a Radix
                trigger sized `w-fit` to text that long spills over the control beside it. Giving
                the row two columns and the date its own line fixes the cause rather than truncating
                the label into "Division-level (no sec…", which is the one option in that list a
                reader has to be able to tell from a named section.
              */}
              <div className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
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
                      <FormLabel>Target date</FormLabel>
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
                {incoming ? (
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email address</FormLabel>
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                ) : null}
              </div>
            </OptionalSection>

            <OptionalSection
              title="Attachments"
              summary="Files to attach, uploaded once the record is saved"
              hasError={hasContentErrors}
            >
              <FormItem>
                <FormLabel htmlFor="register-attachments">Attachments</FormLabel>
                <StagedFiles
                  id="register-attachments"
                  files={staged}
                  onAdd={(added) => setStaged((current) => [...current, ...added])}
                  onRemove={(index) =>
                    setStaged((current) => current.filter((_, i) => i !== index))
                  }
                  disabled={busy}
                />
                <FormDescription>Uploaded once the record is saved.</FormDescription>
              </FormItem>
            </OptionalSection>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={busy || typesFailed}>
                {busy ? <Loader2 className="animate-spin" /> : null}
                {uploadingIndex === null
                  ? 'Register document'
                  : `Uploading ${uploadingIndex + 1} of ${staged.length}`}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        title="Register this document?"
        description="A tracking number is assigned as soon as you confirm, and it goes on the physical document."
        confirmLabel="Register"
        busy={busy}
        onConfirm={() => {
          if (pending !== null) void onSubmit(pending);
        }}
      >
        {pending === null ? null : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Title</dt>
            <dd className="min-w-0 break-words">{pending.title}</dd>
            <dt className="text-muted-foreground">Direction</dt>
            <dd>{pending.direction === 'OUTGOING' ? 'Outgoing' : 'Incoming'}</dd>
            <dt className="text-muted-foreground">Sender</dt>
            <dd className="min-w-0 break-words">
              {pending.direction === 'OUTGOING' ? senderLabel(headOfBureau.data) : pending.sender}
            </dd>
            {pending.direction === 'OUTGOING' ? (
              <>
                <dt className="text-muted-foreground">To</dt>
                <dd className="min-w-0 break-words">
                  {pending.recipients.map((recipient) => recipient.name).join('; ')}
                </dd>
              </>
            ) : null}
            {staged.length === 0 ? null : (
              <>
                <dt className="text-muted-foreground">Files</dt>
                <dd>{staged.length}</dd>
              </>
            )}
          </dl>
        )}
      </ConfirmDialog>
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
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
            >
              <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-xs">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{fileSize(file.size)}</span>
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

/**
 * A fold for the fields that are not needed to file a document.
 *
 * Shut by default and opened by the user — or by the form, when something inside it is why the
 * submit was refused. That second case is the whole reason this takes `hasError` rather than
 * managing its own state alone: a validation message inside a closed panel is invisible, and a
 * dialog that will not save without saying why is worse than one with eleven fields on show.
 *
 * `hasError` only ever forces it OPEN. Clearing the error does not shut it again — the user is
 * mid-correction in there, and closing the panel under them would be the rudest possible moment.
 */
function OptionalSection({
  title,
  summary,
  hasError,
  children,
}: Readonly<{
  title: string;
  summary: string;
  hasError: boolean;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (hasError) setOpen(true);
  }, [hasError]);

  return (
    /*
      A rule and a line of text, not a bordered panel. A filled box inside a dialog that is itself
      a box reads as a third level of container for what is really just "the rest of this form";
      a hairline says the same thing with one pixel.
    */
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={setOpen}
      className="border-t border-border"
    >
      <CollapsiblePrimitive.Trigger asChild>
        <button
          type="button"
          className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-2 text-left outline-none transition-colors duration-150 ease-in-out hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-in-out',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="block text-sm">{title}</span>
            {open ? null : (
              <span className="block truncate text-xs text-muted-foreground">{summary}</span>
            )}
          </span>
          {hasError ? (
            <span className="shrink-0 text-xs font-bold text-destructive">Needs attention</span>
          ) : (
            <span className="shrink-0 text-xs text-muted-foreground">Optional</span>
          )}
        </button>
      </CollapsiblePrimitive.Trigger>

      <CollapsiblePrimitive.Content className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="flex flex-col gap-3 pt-1 pb-3">{children}</div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
