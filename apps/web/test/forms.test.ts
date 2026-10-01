import { describe, expect, it, vi } from 'vitest';
import type { UseFormReturn } from 'react-hook-form';
import { ApiError } from '../src/lib/api';
import { applyServerErrors, safeNextPath } from '../src/lib/forms';

/** The two pieces of a form `applyServerErrors` touches, with nothing else stubbed out. */
const formWith = (fields: Record<string, unknown>) => {
  const setError = vi.fn();
  return {
    form: { getValues: () => fields, setError } as unknown as UseFormReturn<
      Record<string, unknown>
    >,
    setError,
  };
};

describe('applyServerErrors', () => {
  it('puts a rejected field on its own input and shows no banner', () => {
    const { form, setError } = formWith({ email: '', password: '' });
    const error = new ApiError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { fieldErrors: { email: ['Not a valid email address'] } },
    });

    expect(applyServerErrors(form, error)).toBeNull();
    expect(setError).toHaveBeenCalledWith('email', {
      type: 'server',
      message: 'Not a valid email address',
    });
  });

  // A message set on a field the form does not render is stored by react-hook-form and displayed
  // by nothing, so it has to be surfaced as a banner instead — named, or it is meaningless.
  it('surfaces an error for a field the form does not render', () => {
    const { form, setError } = formWith({ title: '' });
    const error = new ApiError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { fieldErrors: { sectionId: ['must belong to the division'] } },
    });

    expect(applyServerErrors(form, error)).toBe('sectionId: must belong to the division');
    expect(setError).not.toHaveBeenCalled();
  });

  it('surfaces a form-level validation message', () => {
    const { form } = formWith({ title: '' });
    const error = new ApiError({
      status: 422,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { formErrors: ['At least one metadata field must be supplied'] },
    });

    expect(applyServerErrors(form, error)).toBe('At least one metadata field must be supplied');
  });

  it('falls back to the server message when nothing is field-specific', () => {
    const { form } = formWith({ title: '' });
    const error = new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Not permitted' });

    expect(applyServerErrors(form, error)).toBe('Not permitted');
  });

  it('handles a failure that never reached the API', () => {
    const { form } = formWith({ title: '' });
    expect(applyServerErrors(form, new TypeError('Failed to fetch'))).toBe('Failed to fetch');
  });
});

describe('safeNextPath', () => {
  it('returns a same-site path unchanged', () => {
    expect(safeNextPath('/documents?status=PENDING')).toBe('/documents?status=PENDING');
  });

  it('falls back when there is no destination', () => {
    expect(safeNextPath(null)).toBe('/documents');
    expect(safeNextPath('')).toBe('/documents');
  });

  /*
   * The whole reason this function exists. `?next=` arrives in a URL anyone can craft and send,
   * so without these checks our own sign-in page becomes a credential-harvesting redirect that a
   * user cannot tell apart from the real one.
   */
  it.each([
    ['an absolute URL', 'https://elsewhere.example/harvest'],
    ['a protocol-relative URL', '//elsewhere.example/harvest'],
    ['a backslash-relative URL', '/\\elsewhere.example'],
    ['an embedded scheme', '/javascript:alert(1)'],
    ['a bare host', 'elsewhere.example'],
  ])('refuses %s', (_label, candidate) => {
    expect(safeNextPath(candidate)).toBe('/documents');
  });
});
