import { describe, expect, it } from 'vitest';
import { resolveMailRecipients } from '../src/modules/mail/mail-recipients.js';

describe('resolveMailRecipients', () => {
  it('lower-cases, de-duplicates and preserves order across recipients and requester', () => {
    expect(
      resolveMailRecipients({
        recipients: [{ name: 'A', emails: ['X@y.ph'] }],
        requesterEmails: ['x@Y.PH', null, 'z@y.ph'],
      }),
    ).toEqual(['x@y.ph', 'z@y.ph']);
  });

  it('returns an empty list for empty inputs', () => {
    expect(resolveMailRecipients({ recipients: [], requesterEmails: [] })).toEqual([]);
  });
});
