import { describe, expect, it } from 'vitest';
import { CAPABILITIES, createDocumentSchema, workflowActionSchema } from '../src/index.js';

describe('shared API contracts', () => {
  it('requires an incoming sender at the runtime boundary', () => {
    const result = createDocumentSchema.safeParse({
      title: 'Incoming request',
      type: 'MEMORANDUM',
      priority: 'NORMAL',
      direction: 'INCOMING',
      divisionId: 'division-a',
    });
    expect(result.success).toBe(false);
  });

  it('preserves the exact approved workflow action vocabulary', () => {
    expect(workflowActionSchema.options).toEqual([
      'ACCEPT',
      'REQUEST_REVISION',
      'RESUBMIT',
      'SUBMIT_FOR_SIGNATURE',
      'SIGN',
      'PREPARE_RELEASE',
      'RELEASE',
      'ARCHIVE',
      'RESTORE',
    ]);
  });
  // The client gates its navigation on these strings and the API's role table grants them, so a
  // rename on either side has to come through this list. Pinning it makes that a deliberate edit
  // rather than a silently one-sided one.
  it('preserves the capability vocabulary both sides gate on', () => {
    expect(CAPABILITIES).toEqual([
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
      'DOCUMENT_DELETE',
      'DOCUMENT_RESTORE',
      'DOCUMENT_ASSIGN',
      'REPORT_VIEW',
      'AUDIT_VIEW',
      'FILE_SCAN_RECORD',
      'USER_MANAGE',
      'ORG_MANAGE',
      'ACCOUNT_REQUEST_REVIEW',
    ]);
  });
});
