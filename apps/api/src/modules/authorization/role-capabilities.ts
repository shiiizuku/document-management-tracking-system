import type { Capability } from '@dts/contracts';
import type { Role } from './authorization.policy.js';

// The capability vocabulary itself lives in `@dts/contracts` (`capabilitySchema`), so the client
// gates its navigation on the same strings this table grants. What stays here is the mapping from
// role to capabilities. It is *served* to role assigners by `GET /roles`, so the role picker can
// describe what a role grants (decision 175 as amended), and it is *gated on* by nobody outside
// the server: the client decides what its own user may do from `/auth/me`, never from this map.

// Identity and organization capabilities. Administrator-only, as agreed in policy register P-11:
// account provisioning, user management and organization changes stay with the administrator,
// and there is no self-service. Changing that means editing P-11 and this constant in the same PR.
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
    // Retained as break-glass, not as the intended signatory: an audit trail reading
    // "System Administrator signed it" is not evidence of approval (ADR-0006). Pilot
    // configuration must provision a real DIRECTOR account.
    'DOCUMENT_SIGN',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    'DOCUMENT_RELEASE_CORRECT',
    'DOCUMENT_COMPLY',
    'DOCUMENT_ARCHIVE',
    // Logical deletion and its reversal are paired and administrator-only: the records office has
    // not delegated deletion, so it stays with the admin role alongside restore.
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
  // Custodians of the record, not signatories to its content (ADR-0006): `DOCUMENT_SIGN` was
  // removed from this role when `DIRECTOR` was introduced. Records staff still see every
  // document in the office — that is the custody role — and sign none of them.
  RECORDS_STAFF: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
    'DOCUMENT_PREPARE_RELEASE',
    'DOCUMENT_RELEASE',
    // Filling in the carrier of a mailed release recorded before carriers were asked for (P-15
    // as decided 2026-10-06). The records office keeps the release record, so it is theirs; a
    // division head can release but cannot amend a release afterwards.
    'DOCUMENT_RELEASE_CORRECT',
    'DOCUMENT_COMPLY',
    'DOCUMENT_ARCHIVE',
    'DOCUMENT_ASSIGN',
    'REPORT_VIEW',
    'FILE_SCAN_RECORD',
  ],
  /*
   * The Regional Director, and the only holder of `DOCUMENT_SIGN` outside the break-glass
   * administrator (ADR-0006). Deliberately the narrowest non-viewer role in the table: signing is
   * the highest-consequence act in the system, so the role that holds it is given nothing else it
   * does not need to perform or justify a signature.
   *
   * It does **not** hold `DOCUMENT_INITIAL`. Initialling is a division head's endorsement taken
   * *before* the Director signs, and an ORD draft skips `FOR_INITIAL` entirely (ADR-0007), so
   * granting it here would only let the Director endorse a draft they are about to sign.
   */
  DIRECTOR: ['DOCUMENT_SIGN', 'REPORT_VIEW'],
  // `DOCUMENT_INITIAL` is a division head's endorsement of an outgoing draft, taken before the
  // Director signs it (ADR-0006). It is held here and nowhere else: the whole point of splitting
  // it out of `DOCUMENT_SIGN` — which this role no longer holds — is that the two acts belong to
  // two authorities. A head who could also sign would make the initial ceremonial.
  DIVISION_HEAD: [
    'DOCUMENT_CREATE',
    'DOCUMENT_EDIT',
    'DOCUMENT_ACCEPT',
    'DOCUMENT_REQUEST_REVISION',
    'DOCUMENT_RESUBMIT',
    'DOCUMENT_INITIAL',
    'DOCUMENT_SUBMIT_FOR_SIGNATURE',
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
