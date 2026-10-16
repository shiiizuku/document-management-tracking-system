'use client';

import { useState } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { skipMailSchema } from '@dts/contracts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { DocumentDetail } from '@/features/documents/queries';
import { useSession } from '@/features/session/queries';
import { cn } from '@/lib/utils';
import { ComposeMailDialog } from './compose-mail-dialog';
import { useMailMessages, useResendMail, useSkipMail, type MailMessage } from './queries';

/** The statuses in which a release email exists to be dealt with (design: Mail section). */
const MAIL_STATUSES: ReadonlySet<string> = new Set(['FOR_RELEASE', 'RELEASED', 'ARCHIVED']);

const STATUS_LABEL: Record<MailMessage['status'], string> = {
  DRAFT: 'Draft',
  QUEUED: 'Queued',
  SENT: 'Sent',
  FAILED: 'Failed',
};

const STATUS_CLASS: Record<MailMessage['status'], string> = {
  DRAFT: 'bg-secondary text-secondary-foreground',
  QUEUED: 'bg-secondary text-secondary-foreground',
  SENT: 'border-border text-foreground',
  FAILED: 'bg-destructive/10 text-destructive',
};

const isSkipped = (message: MailMessage) => message.skippedAt !== null;

/**
 * The one row Resend is offered on: the newest Failed message, and only while no newer message is
 * queued or sent — an older failure that a later send replaced is history, not a task. `rows` is
 * newest first.
 */
const resendableId = (rows: readonly MailMessage[]): string | null => {
  const index = rows.findIndex((row) => row.status === 'FAILED');
  if (index === -1) return null;
  const replaced = rows
    .slice(0, index)
    .some((row) => row.status === 'QUEUED' || row.status === 'SENT');
  return replaced ? null : (rows[index]?.id ?? null);
};

/** To first, then a count for what is copied, so a long list stays on one line. */
const recipientSummary = (message: MailMessage): string => {
  const parts = [message.to.join(', ') || 'No recipients'];
  if (message.cc.length > 0) parts.push(`Cc ${message.cc.length}`);
  if (message.bcc.length > 0) parts.push(`Bcc ${message.bcc.length}`);
  return parts.join(' · ');
};

/**
 * The release email of an outgoing document: its drafts and sends, and the way out of sending one.
 *
 * Shown only to a releaser (`DOCUMENT_RELEASE`, which every mail route needs) and only once there
 * is a release email to speak of — the document is for release, released or archived. Sent and
 * Failed rows are read-only records; a failure is answered by Resend, which the server turns into a
 * new queued row rather than rewriting the old one.
 */
export function DocumentMailSection({ document }: Readonly<{ document: DocumentDetail }>) {
  const { can } = useSession();
  if (
    document.direction !== 'OUTGOING' ||
    !MAIL_STATUSES.has(document.status) ||
    !can('DOCUMENT_RELEASE')
  )
    return null;
  return <MailMessages document={document} />;
}

function MailMessages({ document }: Readonly<{ document: DocumentDetail }>) {
  const messages = useMailMessages(document.id);
  const [composing, setComposing] = useState<MailMessage | null>(null);
  const [skipping, setSkipping] = useState(false);

  const rows = [...(messages.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const forRelease = document.status === 'FOR_RELEASE';
  const sent = rows.some((row) => row.status === 'SENT');
  const skipped = rows.some(isSkipped);
  // The server skips the newest unsent message, so a queued or failed one qualifies as a draft does.
  const canSkip = forRelease && !sent && !skipped && rows.some((row) => row.status !== 'SENT');
  const resendable = resendableId(rows);

  return (
    <section aria-label="Release email" className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Mail className="size-3.5 text-muted-foreground" aria-hidden />
          Release email
        </h3>
        {canSkip ? (
          <Button
            type="button"
            variant="link"
            size="xs"
            className="h-auto p-0"
            onClick={() => setSkipping(true)}
          >
            Skip mail
          </Button>
        ) : null}
      </div>

      {sent || skipped ? (
        <p className="text-xs text-muted-foreground">
          {sent ? 'The mail was sent.' : 'The mail was skipped.'}
        </p>
      ) : null}

      {messages.isPending ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : messages.isError ? (
        <p role="alert" className="text-xs text-destructive">
          The release email could not be loaded.
        </p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No release email was drafted: there was no signed copy to attach when the document was
          prepared for release. Emailed release is not blocked.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <MailRow
              key={row.id}
              documentId={document.id}
              message={row}
              composable={forRelease}
              resendable={row.id === resendable}
              onCompose={() => setComposing(row)}
            />
          ))}
        </ul>
      )}

      <ComposeMailDialog
        documentId={document.id}
        message={composing}
        open={composing !== null}
        onOpenChange={(next) => (next ? undefined : setComposing(null))}
      />
      <SkipMailDialog documentId={document.id} open={skipping} onOpenChange={setSkipping} />
    </section>
  );
}

function MailRow({
  documentId,
  message,
  composable,
  resendable,
  onCompose,
}: Readonly<{
  documentId: string;
  message: MailMessage;
  /** The server sends a draft only while the document is For release. */
  composable: boolean;
  resendable: boolean;
  onCompose: () => void;
}>) {
  const resend = useResendMail(documentId);
  const skipped = isSkipped(message);
  const editable = composable && message.status === 'DRAFT' && !skipped;

  return (
    <li className="flex items-center gap-2 px-2 py-1">
      <Badge
        variant="outline"
        className={cn('px-1.5 py-0 text-[11px]', STATUS_CLASS[message.status])}
      >
        {skipped ? 'Skipped' : STATUS_LABEL[message.status]}
      </Badge>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{message.subject}</p>
        <p className="truncate text-xs text-muted-foreground" title={message.to.join(', ')}>
          {recipientSummary(message)}
          {message.sentAt === null ? null : (
            <>
              {' · '}
              <time dateTime={message.sentAt} className="tabular-nums">
                {new Date(message.sentAt).toLocaleString()}
              </time>
            </>
          )}
        </p>
        {message.status === 'FAILED' && message.lastError !== null ? (
          <p className="text-xs break-words text-destructive">{message.lastError}</p>
        ) : null}
      </div>
      {editable ? (
        <Button type="button" variant="outline" size="xs" onClick={onCompose}>
          Compose
        </Button>
      ) : null}
      {resendable ? (
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={resend.isPending}
          onClick={() =>
            resend.mutate(message.id, {
              onSuccess: () => toast.success('Email queued again'),
              onError: (error) =>
                toast.error('Could not resend the email', {
                  description: error instanceof Error ? error.message : 'Please try again.',
                }),
            })
          }
        >
          {resend.isPending ? <Loader2 className="animate-spin" /> : null}
          Resend
        </Button>
      ) : null}
    </li>
  );
}

/** Why the release email will not be sent. The remark is the evidence, so it is required. */
function SkipMailDialog({
  documentId,
  open,
  onOpenChange,
}: Readonly<{ documentId: string; open: boolean; onOpenChange: (open: boolean) => void }>) {
  const [remarks, setRemarks] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const skip = useSkipMail(documentId);
  const parsed = skipMailSchema.safeParse({ remarks });

  const close = (next: boolean) => {
    onOpenChange(next);
    if (!next) {
      setRemarks('');
      setFailure(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-2 p-4 sm:max-w-md">
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!parsed.success) return;
            setFailure(null);
            skip.mutate(parsed.data, {
              onSuccess: () => {
                close(false);
                toast.success('Mail skipped');
              },
              onError: (error) =>
                setFailure(error instanceof Error ? error.message : 'Please try again.'),
            });
          }}
        >
          <DialogHeader className="gap-0">
            <DialogTitle className="text-base">Skip mail</DialogTitle>
            <DialogDescription className="text-xs">
              The release email will not be sent. Say why; it is kept in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1">
            <Label htmlFor="skip-mail-remarks" className="text-xs">
              Remarks
            </Label>
            <Textarea
              id="skip-mail-remarks"
              rows={3}
              maxLength={2000}
              required
              className="min-h-0 rounded-md px-2 py-1.5 text-sm"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
            />
          </div>
          {failure === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {failure}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" size="xs" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" size="xs" disabled={skip.isPending || !parsed.success}>
              {skip.isPending ? <Loader2 className="animate-spin" /> : null}
              Skip mail
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
