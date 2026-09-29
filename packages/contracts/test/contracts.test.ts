import { describe, expect, it } from 'vitest';
import { createDocumentSchema, workflowActionSchema } from '../src/index.js';

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
});
