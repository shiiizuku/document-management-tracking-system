import type { Capability } from '@dts/contracts';
import type { Role } from './authorization.policy.js';

// The capability vocabulary itself lives in `@dts/contracts` (`capabilitySchema`), so the client
// gates its navigation on the same strings this table grants. What stays here is the mapping from
// role to capabilities — a server-side policy decision the browser never sees.

// Identity and organization capabilities. Provisional per policy register P-11: the approver
// role is not yet fixed by the office, so account provisioning, user management and
// organization changes are all administrator-only until it is. Changing that means editing
// P-11 and this constant in the same PR.
export const USER_MANAGE: Capability = 'USER_MANAGE';
export const ORG_MANAGE: Capability = 'ORG_MANAGE';
export const ACCOUNT_REQUEST_REVIEW: Capability = 'ACCOUNT_REQUEST_REVIEW';
// Already held by ADMINISTRATOR below; named here so the audit policy references the same
// string the role table does rather than repeating a literal.
export const AUDIT_VIEW: Capability = 'AUDIT_VIEW';

export const capabilitiesByRole: Readonly<Record<Role, readonly Capability[]>> = {
  ADMINISTRATOR: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_INITIAL',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_COMPLY',
    'DOCUMENT_ARCHIVE',
    // Logical deletion and its reversal are paired and administrator-only (policy register P-11,
    // provisional): the records office has not yet delegated deletion, so it stays with the admin
    // role alongside restore until P-11 fixes an owner.
    'DOCUMENT_DELETE',
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
    'DOCUMENT_COMPLY',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
    'FILE_SCAN_RECORD',
  ],
  // `DOCUMENT_INITIAL` is a division head's endorsement of an outgoing draft, taken before the
  // Director signs it (ADR-0006). It is held here and nowhere else below: the whole point of
  // splitting it out of `DOCUMENT_SIGN` is that the two acts belong to two authorities.
  DIVISION_HEAD: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_INITIAL',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_COMPLY',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
  ],
  // Complying is recorded by the unit holding the document (decision 163), which is usually the
  // section staff who actually acted on it.
  STAFF_MEMBER: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_COMPLY',
  ],
  VIEWER: [],
};
