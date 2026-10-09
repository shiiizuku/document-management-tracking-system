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
import { useSections } from '@/features/org/queries';
import { ApiError } from '@/lib/api';
import { currentCustody, useRouteDocument, type DocumentDetail } from './queries';

/**
 * Hands a document to one of the sections of the division that holds it (decision 14).
 *
 * "Assigning to a section" is not a separate act: it is a forward whose lead hop stays in the same
 * division and names a section (decision 156 — each section accepts what its division assigned), so
 * this posts to the same `/documents/:id/routes` the Forward dialog uses and inherits its
 * authorization, notification and audit. The sections offered are the custody division's, minus the
 * one it already sits in; the server re-checks the capability and the document's version, so a
 * stale or hand-edited choice is refused there.
 */
export function AssignSectionDialog({
  document,
  open,
  onOpenChange,
}: Readonly<{
  document: DocumentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const [sectionId, setSectionId] = useState('');
  const custody = currentCustody(document);
  const sections = useSections(open ? custody.divisionId : null);
  const route = useRouteDocument(document.id);

  const choices = (sections.data ?? []).filter(
    (section) => section.active && section.id !== custody.sectionId,
  );

  const close = (next: boolean) => {
    if (!next) setSectionId('');
    onOpenChange(next);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (sectionId === '') return;
    route.mutate(
      {
        expectedVersion: document.version,
        toDivisionId: custody.divisionId,
        toSectionId: sectionId,
      },
      {
        onSuccess: () => {
          close(false);
          toast.success('Document assigned to the section', {
            description: `${document.trackingNumber} now waits for the section to accept it.`,
          });
        },
        onError: (error) =>
          toast.error('Could not assign the document', {
            description:
              error instanceof ApiError && error.isConflict
                ? 'This document changed — review it and try again.'
                : error instanceof Error
                  ? error.message
                  : 'Please try again.',
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Assign {document.trackingNumber} to a section</DialogTitle>
            <DialogDescription>
              The section is notified and takes custody once it accepts. The handoff is recorded
              with your name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 py-4">
            <Label htmlFor="assign-section">Section</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger id="assign-section">
                <SelectValue
                  placeholder={
                    sections.isPending
                      ? 'Loading sections…'
                      : choices.length === 0
                        ? 'No other sections'
                        : 'Choose a section'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {choices.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={sectionId === '' || route.isPending}>
              {route.isPending ? <Loader2 className="animate-spin" /> : null}
              Assign to section
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
