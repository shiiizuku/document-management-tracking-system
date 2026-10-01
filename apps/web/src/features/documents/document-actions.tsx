'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { releaseMethodSchema, type ReleaseMethod, type WorkflowAction } from '@dts/contracts';
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
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { ACTION_LABELS } from './action-labels';
import { useRunAction, type DocumentDetail } from './queries';

/**
 * The workflow controls for one document.
 *
 * Which buttons exist is the server's decision: it sends `allowedActions`, computed from the
 * document's status and this actor's capabilities, and this component renders exactly that list.
 * It never consults the status itself, which is what keeps the transition matrix in one place.
 *
 * What it does know is which actions need something typed before they can run — and that is a
 * known, accepted duplication of a rule `WorkflowService` also enforces (see
 * docs/frontend-rebuild-plan.md). It is acceptable because the server still has the final say: if
 * this table is wrong, the result is a validation error rather than a bad transition.
 */

/** The input each action cannot run without. Absent means "run it straight away". */
const ACTION_REQUIRES: Partial<Record<WorkflowAction, 'remarks' | 'releaseMethod'>> = {
  REQUEST_REVISION: 'remarks',
  RELEASE: 'releaseMethod',
};

const RELEASE_METHOD_LABELS: Record<ReleaseMethod, string> = {
  MAILED: 'Mailed',
  EMAILED: 'Emailed',
  PICKED_UP: 'Picked up',
  DELIVERED: 'Delivered',
};

/** Sending a document back for revision is the one action that undoes someone else's work. */
const isDestructive = (action: WorkflowAction) => action === 'REQUEST_REVISION';

export function DocumentActions({ document }: Readonly<{ document: DocumentDetail }>) {
  const runAction = useRunAction(document.id);
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null);
  const [remarks, setRemarks] = useState('');
  const [releaseMethod, setReleaseMethod] = useState<ReleaseMethod>('EMAILED');

  const closeDialog = () => {
    setPendingAction(null);
    setRemarks('');
  };

  const run = (
    action: WorkflowAction,
    extra: { remarks?: string; releaseMethod?: ReleaseMethod },
  ) =>
    runAction.mutate(
      { action, expectedVersion: document.version, ...extra },
      {
        onSuccess: (updated) => {
          closeDialog();
          toast.success(`${ACTION_LABELS[action]} recorded`, {
            description: `${updated.trackingNumber} is now ${updated.status.replaceAll('_', ' ').toLowerCase()}.`,
          });
        },
        onError: (error) => {
          // A 409 means someone else moved this document while it was on screen. The mutation has
          // already refetched it, so the only thing left is to say so — retrying blind against a
          // version that no longer exists would simply fail again.
          if (error instanceof ApiError && error.isConflict) {
            closeDialog();
            toast.error('This document changed — review and retry', {
              description:
                'Someone else acted on it while it was open. The latest version is now shown.',
            });
            return;
          }
          toast.error(`${ACTION_LABELS[action]} failed`, {
            description: error instanceof Error ? error.message : 'Please try again.',
          });
        },
      },
    );

  const onActionClick = (action: WorkflowAction) => {
    if (ACTION_REQUIRES[action] === undefined) {
      run(action, {});
      return;
    }
    setPendingAction(action);
  };

  if (document.allowedActions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflow actions are available to you on this document.
      </p>
    );
  }

  const needs = pendingAction === null ? undefined : ACTION_REQUIRES[pendingAction];

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {document.allowedActions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={isDestructive(action) ? 'destructive' : 'secondary'}
            size="sm"
            disabled={runAction.isPending}
            onClick={() => onActionClick(action)}
          >
            {runAction.isPending && runAction.variables?.action === action ? (
              <Loader2 className="animate-spin" />
            ) : null}
            {ACTION_LABELS[action]}
          </Button>
        ))}
      </div>

      <Dialog open={pendingAction !== null} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent>
          {pendingAction === null ? null : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                run(
                  pendingAction,
                  needs === 'remarks'
                    ? { remarks }
                    : { releaseMethod, ...(remarks ? { remarks } : {}) },
                );
              }}
            >
              <DialogHeader>
                <DialogTitle>{ACTION_LABELS[pendingAction]}</DialogTitle>
                <DialogDescription>
                  {needs === 'remarks'
                    ? 'Say what needs changing. This is recorded on the document timeline and sent to the assignee.'
                    : 'Record how the document left the office. This is kept as part of the release record.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-4">
                {needs === 'releaseMethod' ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="release-method">Delivery method</Label>
                    <Select
                      value={releaseMethod}
                      onValueChange={(value) => setReleaseMethod(value as ReleaseMethod)}
                    >
                      <SelectTrigger id="release-method">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {releaseMethodSchema.options.map((option) => (
                          <SelectItem key={option} value={option}>
                            {RELEASE_METHOD_LABELS[option]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                <div className="space-y-1.5">
                  <Label htmlFor="action-remarks">
                    Remarks{needs === 'remarks' ? '' : ' (optional)'}
                  </Label>
                  <Textarea
                    id="action-remarks"
                    rows={4}
                    maxLength={4000}
                    required={needs === 'remarks'}
                    value={remarks}
                    onChange={(event) => setRemarks(event.target.value)}
                  />
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={isDestructive(pendingAction) ? 'destructive' : 'default'}
                  disabled={
                    runAction.isPending || (needs === 'remarks' && remarks.trim().length === 0)
                  }
                >
                  {runAction.isPending ? <Loader2 className="animate-spin" /> : null}
                  {ACTION_LABELS[pendingAction]}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
