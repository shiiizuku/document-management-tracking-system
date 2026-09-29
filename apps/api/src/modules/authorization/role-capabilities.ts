import type { Role } from './authorization.policy.js';

// Identity and organization capabilities. Provisional per policy register P-11: the approver
// role is not yet fixed by the office, so account provisioning, user management and
// organization changes are all administrator-only until it is. Changing that means editing
// P-11 and this constant in the same PR.
export const USER_MANAGE = 'USER_MANAGE';
export const ORG_MANAGE = 'ORG_MANAGE';
export const ACCOUNT_REQUEST_REVIEW = 'ACCOUNT_REQUEST_REVIEW';
// Already held by ADMINISTRATOR below; named here so the audit policy references the same
// string the role table does rather than repeating a literal.
export const AUDIT_VIEW = 'AUDIT_VIEW';

export const capabilitiesByRole: Readonly<Record<Role, readonly string[]>> = {
  ADMINISTRATOR: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_RESTORE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
    AUDIT_VIEW,
    'FILE_SCAN_RECORD',
    USER_MANAGE,
    ORG_MANAGE,
    ACCOUNT_REQUEST_REVIEW,
  ],
  RECORDS_STAFF: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
    'FILE_SCAN_RECORD',
  ],
  DIVISION_HEAD: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
  ],
  STAFF_MEMBER: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
  ],
  VIEWER: [],
};
