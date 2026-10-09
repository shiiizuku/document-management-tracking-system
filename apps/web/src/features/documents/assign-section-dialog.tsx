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
import { currentCustody, useRouteDocument, useRunAction, type DocumentDetail } from './queries';

/**
 * Whether a section assignment can be offered for this document.
 *
 * Never on a closed record: a forward would reopen custody of a released or archived document, and
 * the detail screen hides Forward for the same reason. And never while the holding unit's own hop is
 * unaccepted unless this user can accept it: a section hop stacked on an unaccepted division hop
 * leaves the stale hop for the next Accept to stamp, so the section would need two acceptances and
 * the wrong hop would record who took it. The dialog accepts the division hop first (below).
 */
export const canAssignToSection = (document: DocumentDetail): boolean => {
  if (document.status === 'RELEASED' || document.status === 'ARCHIVED') return false;
  const hops = document.routes.filter((hop) => !hop.forInformation);
  const lead = hops[hops.length - 1];
  const outstanding = lead !== undefined && lead.acceptedAt === null;
  return !outstanding || document.allowedActions.includes('ACCEPT');
};

/**
 * Hands a document to one of the sections of the division that holds it (decision 14).
 *
 * "Assigning to a section" is not a separate act: it is a forward whose lead hop stays in the same
 * division and names a section (decision 156 — each section accepts what its division assigned), so
 * this posts to the same `/documents/:id/routes` the Forward dialog uses and inherits its
 * authorization, notification and audit. A division hop still waiting on this user is accepted first,
 * so the division takes custody before it hands the document down (decision 156). The sections offered are the custody division's, minus the
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
  const accept = useRunAction(document.id);

  const pending = route.isPending || accept.isPending;

  const choices = (sections.data ?? []).filter(
    (section) => section.active && section.id !== custody.sectionId,
  );

  const close = (next: boolean) => {
    if (!next) setSectionId('');
    onOpenChange(next);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sectionId === '') return;
    try {
      let expectedVersion = document.version;
      if (document.allowedActions.includes('ACCEPT')) {
        // Both calls are the server's own: it re-checks the capability and the version on each.
        const accepted = await accept.mutateAsync({ action: 'ACCEPT', expectedVersion });
        expectedVersion = accepted.version;
      }
      await route.mutateAsync({
        expectedVersion,
        toDivisionId: custody.divisionId,
        toSectionId: sectionId,
      });
      close(false);
      toast.success('Document assigned to the section', {
        description: `${document.trackingNumber} now waits for the section to accept it.`,
      });
    } catch (error) {
      toast.error('Could not assign the document', {
        description:
          error instanceof ApiError && error.isConflict
            ? 'This document changed — review it and try again.'
            : error instanceof Error
              ? error.message
              : 'Please try again.',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={(event) => void submit(event)}>
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
            <Button type="submit" disabled={sectionId === '' || pending}>
              {pending ? <Loader2 className="animate-spin" /> : null}
              Assign to section
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
