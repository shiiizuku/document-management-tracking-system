'use client';

import { useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { mailAddressListSchema, updateMailDraftSchema } from '@dts/contracts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useReloadMail, useSendMail, useUpdateMail, type MailMessage } from './queries';

/** The `To`/`Cc`/`Bcc` cap in `mailAddressListSchema`. */
const ADDRESS_LIMIT = 20;

/**
 * What the dialog says for a failed save or send. `MAIL_NOT_CONFIGURED` is the one the releaser
 * can act on (tell whoever runs the server), so it gets plain words rather than the API's.
 */
const failureMessage = (error: unknown): string => {
  if (error instanceof ApiError && error.code === 'MAIL_NOT_CONFIGURED')
    return 'Mail is not configured';
  return error instanceof Error ? error.message : 'Please try again.';
};

/**
 * One address row's state: its chips, what is typed but not yet a chip, and why that text was
 * refused. Held by the form rather than the field, so Send can commit text still being typed.
 */
interface AddressDraft {
  values: string[];
  text: string;
  error: string | null;
}

const addressDraft = (values: string[]): AddressDraft => ({ values, text: '', error: null });

/**
 * Turns typed text into chips. Validation and normalisation are the contract's own
 * (`mailAddressListSchema`), so a chip is exactly what the server will accept — trimmed,
 * lower-cased and de-duplicated. What does not parse stays as text, with the reason.
 */
const commitText = (values: string[], raw: string): AddressDraft => {
  const pieces = raw.split(/[\s,;]+/).filter((piece) => piece.length > 0);
  if (pieces.length === 0) return addressDraft(values);
  const valid: string[] = [];
  const rejected: string[] = [];
  for (const piece of pieces)
    (mailAddressListSchema.safeParse([piece]).success ? valid : rejected).push(piece);

  let next = values;
  if (valid.length > 0) {
    const merged = mailAddressListSchema.safeParse([...values, ...valid]);
    if (!merged.success) return { values, text: raw, error: `At most ${ADDRESS_LIMIT} addresses` };
    next = merged.data;
  }
  return {
    values: next,
    text: rejected.join(' '),
    error: rejected.length === 0 ? null : `${rejected.join(', ')} is not a valid email address`,
  };
};

/*
 * Keeps focus where it is when a footer button is pressed. Without it the address input blurs on
 * mouse-down, its pending text becomes a chip, the form re-renders, and the click can miss —
 * a second click was needed. Send commits the pending text itself instead.
 */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * The compose form for a release email's draft: address chips, subject, a plain-text body and the
 * signed PDF as a read-only chip. Cc and Bcc stay behind small toggles, as in Gmail, unless the
 * draft already has them.
 *
 * Send saves the edits first and then queues the message, naming the revision that save returned:
 * the server sends only what is stored, and refuses (`MAIL_CHANGED`) when someone else saved over
 * it in between, so nobody mails text they did not review. The form then reloads the stored draft
 * and says why.
 */
export function ComposeMailDialog({
  documentId,
  message,
  open,
  onOpenChange,
}: Readonly<{
  documentId: string;
  message: MailMessage | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-2 p-4 sm:max-w-xl">
        {message === null ? null : (
          <ComposeForm
            documentId={documentId}
            message={message}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ComposeForm({
  documentId,
  message,
  onClose,
}: Readonly<{ documentId: string; message: MailMessage; onClose: () => void }>) {
  const [to, setTo] = useState(() => addressDraft(message.to));
  const [cc, setCc] = useState(() => addressDraft(message.cc));
  const [bcc, setBcc] = useState(() => addressDraft(message.bcc));
  const [showCc, setShowCc] = useState(message.cc.length > 0);
  const [showBcc, setShowBcc] = useState(message.bcc.length > 0);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [failure, setFailure] = useState<string | null>(null);
  const update = useUpdateMail(documentId);
  const send = useSendMail(documentId);
  const reload = useReloadMail(documentId);
  const subjectId = useId();
  const bodyId = useId();

  const busy = update.isPending || send.isPending;
  const complete = subject.trim().length > 0 && body.trim().length > 0;
  // Typed text counts: Send commits it before saving.
  const hasRecipient = to.values.length > 0 || to.text.trim().length > 0;
  const hint = !hasRecipient
    ? 'Add a recipient'
    : complete
      ? null
      : 'A subject and a message are required';

  /** Replaces the form with the stored draft, after a Send refused as `MAIL_CHANGED`. */
  const resetTo = (stored: MailMessage) => {
    setTo(addressDraft(stored.to));
    setCc(addressDraft(stored.cc));
    setBcc(addressDraft(stored.bcc));
    setShowCc((shown) => shown || stored.cc.length > 0);
    setShowBcc((shown) => shown || stored.bcc.length > 0);
    setSubject(stored.subject);
    setBody(stored.body);
  };

  /*
   * Commits what is still typed in each address field, then saves. `null` when any typed text is
   * not an address: the field shows why and nothing is saved, rather than the text being dropped.
   * Otherwise the saved message, whose `revision` is what Send must name.
   */
  const save = async (): Promise<MailMessage | null> => {
    const [nextTo, nextCc, nextBcc] = [to, cc, bcc].map((draft) =>
      commitText(draft.values, draft.text),
    ) as [AddressDraft, AddressDraft, AddressDraft];
    setTo(nextTo);
    setCc(nextCc);
    setBcc(nextBcc);
    if (nextTo.error !== null || nextCc.error !== null || nextBcc.error !== null) return null;
    const parsed = updateMailDraftSchema.safeParse({
      to: nextTo.values,
      cc: nextCc.values,
      bcc: nextBcc.values,
      subject,
      body,
    });
    if (!parsed.success) {
      setFailure('Check the addresses, subject and message');
      return null;
    }
    return update.mutateAsync({ mailId: message.id, input: parsed.data });
  };

  const run = async (andSend: boolean) => {
    setFailure(null);
    try {
      const saved = await save();
      if (saved === null) return;
      if (andSend) await send.mutateAsync({ mailId: message.id, revision: saved.revision });
      toast.success(andSend ? 'Email queued' : 'Draft saved');
      onClose();
    } catch (error) {
      setFailure(failureMessage(error));
      if (error instanceof ApiError && error.code === 'MAIL_CHANGED') {
        const stored = await reload(message.id).catch(() => undefined);
        if (stored !== undefined) resetTo(stored);
      }
    }
  };

  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <DialogHeader className="gap-0">
        <DialogTitle className="text-base">Release email</DialogTitle>
        <DialogDescription className="text-xs">
          The signed copy goes out as an attachment.
        </DialogDescription>
      </DialogHeader>

      <AddressField
        label="To"
        draft={to}
        onChange={setTo}
        toggles={
          <>
            {showCc ? null : (
              <Button type="button" variant="ghost" size="xs" onClick={() => setShowCc(true)}>
                Cc
              </Button>
            )}
            {showBcc ? null : (
              <Button type="button" variant="ghost" size="xs" onClick={() => setShowBcc(true)}>
                Bcc
              </Button>
            )}
          </>
        }
      />
      {showCc ? <AddressField label="Cc" draft={cc} onChange={setCc} /> : null}
      {showBcc ? <AddressField label="Bcc" draft={bcc} onChange={setBcc} /> : null}

      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-2">
        <Label htmlFor={subjectId} className="text-xs text-muted-foreground">
          Subject
        </Label>
        <Input
          id={subjectId}
          fieldSize="filter"
          className="h-8 rounded-md px-2 text-sm"
          maxLength={240}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div className="grid gap-1">
        <Label htmlFor={bodyId} className="sr-only">
          Message
        </Label>
        <Textarea
          id={bodyId}
          rows={8}
          maxLength={10000}
          className="min-h-0 rounded-md px-2 py-1.5 text-sm"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <div className="flex">
        <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-0.5 text-xs">
          <FileText className="size-3 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{message.attachmentName}</span>
        </span>
      </div>

      {failure === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {failure}
        </p>
      )}

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <span className="text-xs text-muted-foreground">{hint}</span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={busy || !complete}
            onMouseDown={keepFocus}
            onClick={() => void run(false)}
          >
            {update.isPending && !send.isPending ? <Loader2 className="animate-spin" /> : null}
            Save draft
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={busy || !hasRecipient || !complete}
            onMouseDown={keepFocus}
            onClick={() => void run(true)}
          >
            {busy ? <Loader2 className="animate-spin" /> : null}
            Send
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

/**
 * One address row: chips and a bare input. Enter, a comma, whitespace or leaving the field adds
 * what was typed; Backspace in an empty field removes the last chip. See {@link commitText}.
 */
function AddressField({
  label,
  draft,
  onChange,
  toggles,
}: Readonly<{
  label: string;
  draft: AddressDraft;
  onChange: (draft: AddressDraft) => void;
  toggles?: ReactNode;
}>) {
  const id = useId();
  const { values, text, error } = draft;
  const commit = (raw: string) => onChange(commitText(values, raw));

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Never submit the form from here: Send is the only thing that sends.
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange({ ...draft, values: values.slice(0, -1) });
    }
  };

  return (
    <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-2">
      <Label htmlFor={id} className="pt-1.5 text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="min-w-0">
        <div className="flex items-start gap-1">
          <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1 rounded-md border-[1.5px] border-input bg-card px-1.5 py-0.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
            {values.map((address) => (
              <span
                key={address}
                className="inline-flex max-w-full items-center gap-0.5 rounded bg-secondary px-1.5 text-xs"
              >
                <span className="truncate">{address}</span>
                <button
                  type="button"
                  aria-label={`Remove ${address}`}
                  className="rounded text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  onClick={() =>
                    onChange({ ...draft, values: values.filter((value) => value !== address) })
                  }
                >
                  <X className="size-3" aria-hidden />
                </button>
              </span>
            ))}
            <input
              id={id}
              type="text"
              inputMode="email"
              autoComplete="off"
              aria-invalid={error !== null}
              className="min-w-24 flex-1 bg-transparent py-0.5 text-sm outline-none"
              value={text}
              onChange={(event) => {
                const next = event.target.value;
                if (/[\s,;]/.test(next)) commit(next);
                else onChange({ ...draft, text: next });
              }}
              onKeyDown={onKeyDown}
              onBlur={() => commit(text)}
            />
          </div>
          {toggles}
        </div>
        {error === null ? null : <p className="mt-0.5 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
