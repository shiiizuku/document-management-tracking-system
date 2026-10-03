import type { Capability } from '@dts/contracts';

/**
 * What each capability is called when an administrator is deciding what a person may do.
 *
 * `enumLabel('DOCUMENT_SUBMIT_FOR_SIGNATURE')` reads "Document submit for signature", which is the
 * code talking. These are the office's words, a draft for the office to read once before the pilot.
 *
 * Typed as a full `Record` so a capability added to the contract without a label is a compile
 * error rather than a blank chip.
 */
export type CapabilityGroup = 'Documents' | 'Reports and audit' | 'Administration';

export const CAPABILITY_GROUPS: readonly CapabilityGroup[] = [
  'Documents',
  'Reports and audit',
  'Administration',
];

export const capabilityLabels: Readonly<
  Record<Capability, { label: string; group: CapabilityGroup }>
> = {
  DOCUMENT_CREATE: { label: 'Register documents', group: 'Documents' },
  DOCUMENT_EDIT: { label: 'Edit document details', group: 'Documents' },
  DOCUMENT_ACCEPT: { label: 'Accept forwarded documents', group: 'Documents' },
  DOCUMENT_ASSIGN: { label: 'Forward, assign and share', group: 'Documents' },
  DOCUMENT_REQUEST_REVISION: { label: 'Return for revision', group: 'Documents' },
  DOCUMENT_RESUBMIT: { label: 'Resubmit after revision', group: 'Documents' },
  DOCUMENT_INITIAL: { label: "Initial (division head's endorsement)", group: 'Documents' },
  DOCUMENT_SUBMIT_FOR_SIGNATURE: { label: 'Submit for signature', group: 'Documents' },
  DOCUMENT_SIGN: { label: 'Sign (Regional Director)', group: 'Documents' },
  DOCUMENT_PREPARE_RELEASE: { label: 'Prepare for release', group: 'Documents' },
  DOCUMENT_RELEASE: { label: 'Release', group: 'Documents' },
  DOCUMENT_COMPLY: { label: 'Record as complied', group: 'Documents' },
  DOCUMENT_ARCHIVE: { label: 'Archive', group: 'Documents' },
  DOCUMENT_DELETE: { label: 'Delete', group: 'Documents' },
  DOCUMENT_RESTORE: { label: 'Restore archived or deleted', group: 'Documents' },
  REPORT_VIEW: { label: 'View and export reports', group: 'Reports and audit' },
  AUDIT_VIEW: { label: 'View the audit trail', group: 'Reports and audit' },
  FILE_SCAN_RECORD: { label: 'Record attachment scan results', group: 'Administration' },
  USER_MANAGE: { label: 'Manage user accounts', group: 'Administration' },
  ORG_MANAGE: { label: 'Manage divisions and sections', group: 'Administration' },
  ACCOUNT_REQUEST_REVIEW: { label: 'Approve account requests', group: 'Administration' },
};
