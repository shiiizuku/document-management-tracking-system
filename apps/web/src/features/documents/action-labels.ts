import type { WorkflowAction } from '@dts/contracts';

/**
 * How each workflow action is named to a user.
 *
 * Shared by the action buttons and the timeline, which must agree: a button labelled "Accept &
 * begin" that records a timeline entry reading "ACCEPT" leaves the user matching enum names to
 * the control they pressed.
 */
const ACTION_LABELS: Record<WorkflowAction, string> = {
  // Accepting is taking custody of a hop handed to your unit, not starting work on a new document
  // — it happens at every hop and may happen several times on one document (ADR-0005).
  ACCEPT: 'Accept custody',
  REQUEST_REVISION: 'Request revision',
  RESUBMIT: 'Resubmit',
  // A division head's endorsement of an outgoing draft, before the Director signs it (ADR-0006).
  // "Initial" as the bureau uses it — a distinct act by a distinct authority, not a lesser
  // signature — so the label says so rather than reading as a smaller version of signing.
  INITIAL: 'Record initial',
  SUBMIT_FOR_SIGNATURE: 'Submit for signature',
  SIGN: 'Record signature',
  PREPARE_RELEASE: 'Prepare release',
  RELEASE: 'Release document',
  // The incoming terminal: acted upon, with remarks, by the unit holding it (decision 163).
  COMPLY: 'Record compliance',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore',
};

/**
 * The label for an action. Takes a plain string because timeline entries arrive as stored text:
 * an action recorded before a vocabulary change still has to render, and showing the raw value
 * beats showing nothing.
 */
export const workflowActionLabel = (action: string): string =>
  ACTION_LABELS[action as WorkflowAction] ?? action;

export { ACTION_LABELS };
