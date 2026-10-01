import type { FieldValues, Path, UseFormReturn } from 'react-hook-form';
import { ApiError } from './api';

/**
 * Moves a rejected request's errors onto the form that caused it.
 *
 * Client and server validate with the same schema, so a field error from the server is either a
 * rule the client could not check (uniqueness, cross-record state) or a schema drift worth seeing.
 * Either way it belongs on the field, not in a toast the user has to map back to an input
 * themselves.
 *
 * Returns the message that could not be attached to any field — a form-level validation message,
 * a conflict, a permission refusal — or null when every error found a home. Callers render that
 * return value above the form and need no other error handling.
 */
export function applyServerErrors<
  Values extends FieldValues,
  Context = unknown,
  // Separate from `Values` because a schema carrying a default — `confidential: false`, say —
  // makes a form's input and output shapes differ, and such a form must still be able to report
  // its server errors.
  Output extends FieldValues = Values,
>(form: UseFormReturn<Values, Context, Output>, error: unknown): string | null {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  }

  // Only fields this form actually renders. Setting an error on a name the form does not know
  // would silently swallow the message: react-hook-form stores it, and nothing displays it.
  const known = new Set(Object.keys(form.getValues()));
  const unattached: string[] = [...error.formErrors];
  let attached = 0;

  for (const [field, messages] of Object.entries(error.fieldErrors)) {
    const message = messages[0];
    if (message === undefined) continue;
    if (known.has(field)) {
      form.setError(field as Path<Values>, { type: 'server', message });
      attached += 1;
    } else {
      // Name the field: "sectionId must belong to the division" is useless without the subject.
      unattached.push(`${field}: ${message}`);
    }
  }

  if (unattached.length > 0) return unattached.join(' ');
  // A validation failure whose fields all landed needs no banner; anything else does.
  return attached > 0 ? null : error.message;
}

/**
 * Validates a `?next=` destination before navigating to it.
 *
 * The login screen is reached with the path the user was trying to open, and that path arrives in
 * a URL anyone can craft. Without this check, a link to
 * `/login?next=https://elsewhere.example/` turns our own sign-in page into a credential-harvesting
 * redirect that users have no way to distinguish from the real thing.
 *
 * Only a same-site absolute path is accepted: it must start with a single `/`, and must not be a
 * protocol-relative `//host` or carry a scheme. Anything else falls back to the dashboard, which
 * is where `/` leads too.
 */
export function safeNextPath(raw: string | null, fallback = '/dashboard'): string {
  if (raw === null || raw === '') return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  // A backslash is treated as a slash by some browsers, so `/\evil.example` is protocol-relative
  // in practice; a colon before the first `/` would make it a scheme.
  if (raw.startsWith('/\\') || /^\/[^/?#]*:/.test(raw)) return fallback;
  return raw;
}
