'use client';

import { useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ReleaseMethodCode, WorkflowAction } from '@dts/contracts';
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
import { useReleaseMethods, useRunAction, type DocumentDetail } from './queries';

/**
 * Running one of the server-offered workflow actions, wherever that is offered from.
 *
 * Two surfaces start the same transitions: the action bar on the document page and the command
 * palette. Everything between "the user chose RELEASE" and "the document moved" is here rather
 * than in either of them — which input each action needs, the dialog that collects it, the
 * optimistic-concurrency 409, and the toasts. A second copy of that in the palette would be a
 * second place for the 409 path to be subtly wrong, and that is the path nobody exercises by hand.
 *
 * The caller supplies only the controls: a row of buttons, or a list of command items.
 */

/**
 * The input each action cannot run without. Absent means "run it straight away".
 *
 * A known, accepted duplication of a rule `WorkflowService` also enforces (see
 * docs/audits/frontend-rebuild-plan.md). It is acceptable because the server still has the final say: if
 * this table is wrong, the result is a validation error rather than a bad transition.
 *
 * `COMPLY` was missing from it, which made the row above untrue in the one direction that matters:
 * the server requires compliance remarks (decision 163, `COMPLY_REMARKS_REQUIRED`), so pressing
 * **Record compliance** sent an empty command and the only outcome was a toast saying it failed —
 * the terminal state of every incoming document was unreachable from the UI. Found by writing
 * `docs/acceptance-scenarios.md` §1.5 down and then trying to perform it.
 */
const ACTION_REQUIRES: Partial<Record<WorkflowAction, 'remarks' | 'releaseMethod'>> = {
  REQUEST_REVISION: 'remarks',
  COMPLY: 'remarks',
  RELEASE: 'releaseMethod',
};

/**
 * What the dialog says it is collecting, per action rather than per input kind.
 *
 * Two actions now ask for remarks and they ask for different things — a revision request says what
 * must change, a compliance record says what was done — so one sentence keyed on "needs remarks"
 * would be wrong for one of them.
 */
const ACTION_PROMPTS: Partial<Record<WorkflowAction, string>> = {
  REQUEST_REVISION:
    'Say what needs changing. This is recorded on the document timeline and sent to the assignee.',
  COMPLY:
    'Record what was done about this document. The remark is the evidence that it was acted upon, so it is required.',
  RELEASE: 'Record how the document left the office. This is kept as part of the release record.',
};

/** Sending a document back for revision is the one action that undoes someone else's work. */
export const isDestructiveAction = (action: WorkflowAction): boolean =>
  action === 'REQUEST_REVISION';

export interface ActionRunner {
  /**
   * Begins an action: sends it immediately, or opens the dialog that collects what it needs. The
   * caller does not need to know which, so a control never has to consult {@link ACTION_REQUIRES}.
   */
  start: (action: WorkflowAction) => void;
  /** True while a command is in flight, for disabling the controls that start another. */
  isPending: boolean;
  /** The action currently being sent, so the control that started it can show the spinner. */
  runningAction: WorkflowAction | undefined;
  /** The input dialog. Rendered once by the caller, as a sibling of its controls. */
  dialog: ReactNode;
}

/**
 * `document` is nullable for the command palette, which is mounted in the app shell on every
 * route and therefore often has no document in view. Passing it through rather than calling this
 * hook conditionally is what keeps the palette one flat component with one set of hooks; with no
 * document there is nothing to act on, so `start` does nothing and there is no dialog.
 */
export function useActionRunner(document: DocumentDetail | undefined): ActionRunner {
  const runAction = useRunAction(document?.id ?? '');
  const [pendingAction, setPendingAction] = useState<WorkflowAction | null>(null);
  const [remarks, setRemarks] = useState('');
  const [releaseMethodCode, setReleaseMethodCode] = useState<ReleaseMethodCode | null>(null);
  const [releaseCarrierCode, setReleaseCarrierCode] = useState<ReleaseMethodCode | null>(null);
  const [trackingReference, setTrackingReference] = useState('');

  const needs = pendingAction === null ? undefined : ACTION_REQUIRES[pendingAction];
  /*
   * The methods are configured rows, not a compiled list (policy register P-15), so the dialog
   * cannot know them until they are fetched — and it only fetches them once a release dialog is
   * actually open, because the command palette mounts this hook on every route.
   */
  const releaseMethods = useReleaseMethods(needs === 'releaseMethod');
  const options = releaseMethods.data ?? [];
  /*
   * The selection falls back to the first configured method rather than being initialized to a
   * hard-coded code: with the list configurable, any constant here is one the office can delete.
   */
  const selectedMethod =
    options.find((option) => option.code === releaseMethodCode) ?? options[0] ?? null;
  /*
   * The second question, asked only when the method takes a carrier (Mailed; P-15 as decided
   * 2026-10-06). Deliberately no default: "which carrier" is the answer the record exists to hold,
   * and a preselected Postal would be recorded by everyone who did not look.
   */
  const needsCarrier = selectedMethod?.requiresCarrier ?? false;
  const carriers = selectedMethod?.carriers ?? [];
  const selectedCarrier = needsCarrier
    ? (carriers.find((carrier) => carrier.code === releaseCarrierCode) ?? null)
    : null;
  const needsTracking = selectedCarrier?.requiresTrackingReference ?? false;

  const closeDialog = () => {
    setPendingAction(null);
    setRemarks('');
    setReleaseCarrierCode(null);
    setTrackingReference('');
  };

  const run = (
    action: WorkflowAction,
    extra: {
      remarks?: string;
      releaseMethod?: ReleaseMethodCode;
      releaseCarrier?: ReleaseMethodCode;
      trackingReference?: string;
    },
  ) => {
    if (document === undefined) return;
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
          // A 409 means the caller's copy was stale. The mutation has already refetched it, so the
          // only thing left is to say so — retrying blind against a version that no longer exists
          // would simply fail again.
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
  };

  const start = (action: WorkflowAction) => {
    if (document === undefined) return;
    if (ACTION_REQUIRES[action] === undefined) {
      run(action, {});
      return;
    }
    setPendingAction(action);
  };

  const dialog = (
    <Dialog open={pendingAction !== null} onOpenChange={(open) => (open ? null : closeDialog())}>
      <DialogContent>
        {pendingAction === null ? null : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (needs === 'remarks') {
                run(pendingAction, { remarks });
                return;
              }
              if (selectedMethod === null || (needsCarrier && selectedCarrier === null)) return;
              run(pendingAction, {
                releaseMethod: selectedMethod.code,
                ...(selectedCarrier === null ? {} : { releaseCarrier: selectedCarrier.code }),
                ...(needsTracking ? { trackingReference: trackingReference.trim() } : {}),
                ...(remarks ? { remarks } : {}),
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>{ACTION_LABELS[pendingAction]}</DialogTitle>
              <DialogDescription>{ACTION_PROMPTS[pendingAction]}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {needs === 'releaseMethod' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="release-method">Delivery method</Label>
                    <Select
                      value={selectedMethod?.code ?? ''}
                      disabled={options.length === 0}
                      onValueChange={(value) => {
                        setReleaseMethodCode(value);
                        setReleaseCarrierCode(null);
                        setTrackingReference('');
                      }}
                    >
                      <SelectTrigger id="release-method">
                        <SelectValue
                          placeholder={
                            releaseMethods.isPending ? 'Loading methods…' : 'No methods configured'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((option) => (
                          <SelectItem key={option.code} value={option.code}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {needsCarrier ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="release-carrier">Carrier</Label>
                      <Select
                        value={selectedCarrier?.code ?? ''}
                        disabled={carriers.length === 0}
                        onValueChange={(value) => {
                          setReleaseCarrierCode(value);
                          setTrackingReference('');
                        }}
                      >
                        <SelectTrigger id="release-carrier">
                          <SelectValue
                            placeholder={
                              carriers.length === 0 ? 'No carriers configured' : 'Choose a carrier'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {carriers.map((carrier) => (
                            <SelectItem key={carrier.code} value={carrier.code}>
                              {carrier.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {/* Required by the carrier, not by the action: a consignment that is recorded
                      without its tracking number cannot be traced (decision 27). */}
                  {needsTracking ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="tracking-reference">
                        {selectedCarrier?.label} tracking reference
                      </Label>
                      <Input
                        id="tracking-reference"
                        required
                        maxLength={120}
                        value={trackingReference}
                        onChange={(event) => setTrackingReference(event.target.value)}
                      />
                    </div>
                  ) : null}
                </>
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
                variant={isDestructiveAction(pendingAction) ? 'destructive' : 'default'}
                disabled={
                  runAction.isPending ||
                  (needs === 'remarks' && remarks.trim().length === 0) ||
                  (needs === 'releaseMethod' &&
                    (selectedMethod === null ||
                      (needsCarrier && selectedCarrier === null) ||
                      (needsTracking && trackingReference.trim().length === 0)))
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
  );

  return {
    start,
    isPending: runAction.isPending,
    runningAction: runAction.isPending ? runAction.variables?.action : undefined,
    dialog,
  };
}
