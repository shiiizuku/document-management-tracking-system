import type { DocumentRecipient } from '@dts/contracts';

/**
 * Flattens the outgoing document's recipient emails and the requester's emails into one list:
 * lower-cased, de-duplicated, first-seen order. Missing addresses (null/blank) are skipped.
 */
export function resolveMailRecipients(input: {
  recipients: DocumentRecipient[];
  requesterEmails: (string | null)[];
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const candidates = [...input.recipients.flatMap((r) => r.emails), ...input.requesterEmails];
  for (const raw of candidates) {
    const email = raw?.trim().toLowerCase();
    if (email && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}
