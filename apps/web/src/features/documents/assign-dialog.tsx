'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { enumLabel } from '@/lib/utils';
import { useAssignableUsers, useAssignDocument } from './queries';

/**
 * Picks a colleague to hand a document to.
 *
 * The people offered are whoever the server says this user may see (`/users/assignable`); the
 * assignment itself is authorized again on the server, so a stale or hand-edited choice is refused
 * there rather than trusted here.
 */
export function AssignDialog({
  documentId,
  trackingNumber,
  open,
  onOpenChange,
}: Readonly<{
  documentId: string;
  trackingNumber: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [recipientId, setRecipientId] = useState('');
  const people = useAssignableUsers(open);
  const assign = useAssignDocument(documentId);

  const close = (next: boolean) => {
    if (!next) setRecipientId('');
    onOpenChange(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (recipientId === '') return;
    assign.mutate(recipientId, {
      onSuccess: () => {
        close(false);
        toast.success('Document assigned', { description: `${trackingNumber} is on their list.` });
      },
      onError: (error) =>
        toast.error('Could not assign the document', {
          description: error instanceof Error ? error.message : 'Please try again.',
        }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Assign {trackingNumber}</DialogTitle>
            <DialogDescription>
              The person you choose is notified and finds it in their My work list.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-4">
            <Label htmlFor="assignee">Assign to</Label>
            <Select value={recipientId} onValueChange={setRecipientId}>
              <SelectTrigger id="assignee">
                <SelectValue
                  placeholder={people.isPending ? 'Loading people…' : 'Choose a person'}
                />
              </SelectTrigger>
              <SelectContent>
                {(people.data ?? []).map((person) => (
                  <SelectItem key={person.id} value={person.id}>
                    {person.displayName} · {enumLabel(person.role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={recipientId === '' || assign.isPending}>
              {assign.isPending ? <Loader2 className="animate-spin" /> : null}
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
