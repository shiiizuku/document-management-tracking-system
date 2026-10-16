'use client';

import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
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
import { useSendMail, useUpdateMail, type MailMessage } from './queries';

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
 * The compose form for a release email's draft: address chips, subject, a plain-text body and the
 * signed PDF as a read-only chip. Cc and Bcc stay behind small toggles, as in Gmail, unless the
 * draft already has them.
 *
 * Send saves the edits first and then queues the message; the server sends only what is stored,
 * so a Send that skipped the save would mail the previous text.
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
  const [to, setTo] = useState(message.to);
  const [cc, setCc] = useState(message.cc);
  const [bcc, setBcc] = useState(message.bcc);
  const [showCc, setShowCc] = useState(message.cc.length > 0);
  const [showBcc, setShowBcc] = useState(message.bcc.length > 0);
  const [subject, setSubject] = useState(message.subject);
  const [body, setBody] = useState(message.body);
  const [failure, setFailure] = useState<string | null>(null);
  const update = useUpdateMail(documentId);
  const send = useSendMail(documentId);
  const subjectId = useId();
  const bodyId = useId();

  const busy = update.isPending || send.isPending;
  const complete = subject.trim().length > 0 && body.trim().length > 0;
  const hint =
    to.length === 0 ? 'Add a recipient' : complete ? null : 'A subject and a message are required';

  const save = async (): Promise<boolean> => {
    const parsed = updateMailDraftSchema.safeParse({ to, cc, bcc, subject, body });
    if (!parsed.success) {
      setFailure('Check the addresses, subject and message');
      return false;
    }
    await update.mutateAsync({ mailId: message.id, input: parsed.data });
    return true;
  };

  const run = async (andSend: boolean) => {
    setFailure(null);
    try {
      if (!(await save())) return;
      if (andSend) await send.mutateAsync(message.id);
      toast.success(andSend ? 'Email queued' : 'Draft saved');
      onClose();
    } catch (error) {
      setFailure(failureMessage(error));
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
        values={to}
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
      {showCc ? <AddressField label="Cc" values={cc} onChange={setCc} /> : null}
      {showBcc ? <AddressField label="Bcc" values={bcc} onChange={setBcc} /> : null}

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
            onClick={() => void run(false)}
          >
            {update.isPending && !send.isPending ? <Loader2 className="animate-spin" /> : null}
            Save draft
          </Button>
          <Button
            type="button"
            size="xs"
            disabled={busy || to.length === 0 || !complete}
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
 * what was typed; Backspace in an empty field removes the last chip.
 *
 * Validation and normalisation are the contract's own (`mailAddressListSchema`), so a chip is
 * exactly what the server will accept — trimmed, lower-cased and de-duplicated.
 */
function AddressField({
  label,
  values,
  onChange,
  toggles,
}: Readonly<{
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  toggles?: ReactNode;
}>) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const commit = (raw: string) => {
    const pieces = raw.split(/[\s,;]+/).filter((piece) => piece.length > 0);
    if (pieces.length === 0) {
      setText('');
      return;
    }
    const valid: string[] = [];
    const rejected: string[] = [];
    for (const piece of pieces)
      (mailAddressListSchema.safeParse([piece]).success ? valid : rejected).push(piece);

    if (valid.length > 0) {
      const merged = mailAddressListSchema.safeParse([...values, ...valid]);
      if (!merged.success) {
        setError(`At most ${ADDRESS_LIMIT} addresses`);
        return;
      }
      onChange(merged.data);
    }
    setText(rejected.join(' '));
    setError(rejected.length === 0 ? null : `${rejected.join(', ')} is not a valid email address`);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Never submit the form from here: Send is the only thing that sends.
      event.preventDefault();
      commit(text);
    } else if (event.key === 'Backspace' && text === '' && values.length > 0) {
      onChange(values.slice(0, -1));
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
                  onClick={() => onChange(values.filter((value) => value !== address))}
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
                else setText(next);
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
