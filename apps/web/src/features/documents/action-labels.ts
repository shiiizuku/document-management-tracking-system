import type { WorkflowAction } from '@dts/contracts';

/**
 * How each workflow action is named to a user.
 *
 * Shared by the action buttons and the timeline, which must agree: a button labelled "Accept &
 * begin" that records a timeline entry reading "ACCEPT" leaves the user matching enum names to
 * the control they pressed.
 */
const ACTION_LABELS: Record<WorkflowAction, string> = {
  ACCEPT: 'Accept & begin',
  REQUEST_REVISION: 'Request revision',
  RESUBMIT: 'Resubmit',
  SUBMIT_FOR_SIGNATURE: 'Submit for signature',
  SIGN: 'Record signature',
  PREPARE_RELEASE: 'Prepare release',
  RELEASE: 'Release document',
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
