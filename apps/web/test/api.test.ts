import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, download } from '../src/lib/api';

/** Builds a Response the way the API's HttpErrorFilter does. */
const errorResponse = (
  status: number,
  error: { code: string; message: string; details?: unknown; correlationId?: string },
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const okResponse = (data: unknown) =>
  new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = 'dts_csrf=token-abc';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('unwraps the success envelope', async () => {
    fetchMock.mockResolvedValue(okResponse({ id: 'doc-1' }));
    await expect(api('/documents/doc-1')).resolves.toEqual({ id: 'doc-1' });
  });

  it('sends credentials, and the CSRF header only on unsafe methods', async () => {
    // A Response body can only be read once, so each call needs a fresh one.
    fetchMock.mockImplementation(() => Promise.resolve(okResponse(null)));
    await api('/documents');
    const [, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(getInit.credentials).toBe('include');
    expect(getInit.headers).not.toHaveProperty('X-CSRF-Token');

    await api('/documents', { method: 'POST', body: '{}' });
    const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(postInit.headers).toMatchObject({ 'X-CSRF-Token': 'token-abc' });
  });

  it('returns undefined for 204 rather than parsing an empty body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api('/notifications/n-1/read', { method: 'POST' })).resolves.toBeUndefined();
  });

  it('surfaces a 409 conflict so a stale write can refetch and retry', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(409, {
        code: 'DOCUMENT_VERSION_CONFLICT',
        message: 'Document was modified by another user',
        correlationId: 'corr-409',
      }),
    );
    const error = await api('/documents/doc-1/actions/ACCEPT', { method: 'POST' }).catch(
      (cause: unknown) => cause,
    );

    expect(error).toBeInstanceOf(ApiError);
    const conflict = error as ApiError;
    expect(conflict.isConflict).toBe(true);
    expect(conflict.isForbidden).toBe(false);
    expect(conflict.code).toBe('DOCUMENT_VERSION_CONFLICT');
    expect(conflict.correlationId).toBe('corr-409');
  });

  it('distinguishes 403 from 401, since re-authenticating does not fix a scope denial', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(403, { code: 'FORBIDDEN', message: 'Outside your division scope' }),
    );
    const forbidden = (await api('/documents/other-division').catch(
      (cause: unknown) => cause,
    )) as ApiError;
    expect(forbidden.isForbidden).toBe(true);
    expect(forbidden.isUnauthenticated).toBe(false);

    fetchMock.mockResolvedValue(
      errorResponse(401, { code: 'UNAUTHENTICATED', message: 'Session expired' }),
    );
    const expired = (await api('/auth/me').catch((cause: unknown) => cause)) as ApiError;
    expect(expired.isUnauthenticated).toBe(true);
    expect(expired.isForbidden).toBe(false);
  });

  it('exposes Zod field errors so a form can mark the offending inputs', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(400, {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: {
          formErrors: ['Outgoing documents require a division'],
          fieldErrors: { title: ['Title is required'], priority: undefined },
        },
      }),
    );
    const invalid = (await api('/documents', { method: 'POST', body: '{}' }).catch(
      (cause: unknown) => cause,
    )) as ApiError;

    expect(invalid.fieldErrors).toEqual({ title: ['Title is required'] });
    expect(invalid.formErrors).toEqual(['Outgoing documents require a division']);
  });

  it('has empty field accessors when the failure is not a validation error', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, { code: 'HTTP_500', message: 'boom' }));
    const failure = (await api('/documents').catch((cause: unknown) => cause)) as ApiError;
    expect(failure.fieldErrors).toEqual({});
    expect(failure.formErrors).toEqual([]);
  });

  it('keeps the real status when a gateway returns non-JSON, and takes the header correlation ID', async () => {
    fetchMock.mockResolvedValue(
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        statusText: 'Bad Gateway',
        headers: { 'Content-Type': 'text/html', 'x-correlation-id': 'corr-502' },
      }),
    );
    const failure = (await api('/documents').catch((cause: unknown) => cause)) as ApiError;

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(502);
    expect(failure.code).toBe('HTTP_502');
    expect(failure.correlationId).toBe('corr-502');
  });
});

describe('download', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let click: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:dts/1');
    revokeObjectURL = vi.fn();
    click = vi.fn<() => void>();
    // jsdom implements neither object URLs nor a navigating anchor click.
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }));
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
  });

  // The body is a string, not a Blob: under Node 22 the jsdom Blob is not the one undici's
  // Response expects, and constructing from it throws "object.stream is not a function".
  // `response.blob()` still yields a Blob for the code under test.
  const pdfResponse = (disposition?: string) =>
    new Response('%PDF-1.7', {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        ...(disposition ? { 'Content-Disposition': disposition } : {}),
      },
    });

  it('saves a PDF under the filename the server chose', async () => {
    fetchMock.mockResolvedValue(pdfResponse('attachment; filename="dts-monthly-2026-10.pdf"'));

    await expect(download('/reports/monthly.pdf')).resolves.toBe('dts-monthly-2026-10.pdf');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    // The object URL must not be leaked once the browser has the blob.
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:dts/1');
  });

  it('prefers the RFC 5987 filename and keeps only the basename', async () => {
    fetchMock.mockResolvedValue(
      pdfResponse(
        'attachment; filename="fallback.pdf"; filename*=UTF-8\'\'../../etc/r%C3%A9sum%C3%A9.pdf',
      ),
    );
    await expect(download('/reports/monthly.pdf')).resolves.toBe('résumé.pdf');
  });

  it('falls back when the server sends no Content-Disposition', async () => {
    fetchMock.mockResolvedValue(pdfResponse());
    await expect(download('/reports/monthly.pdf', 'report.pdf')).resolves.toBe('report.pdf');
  });

  it('raises the JSON envelope as an ApiError instead of saving the error body', async () => {
    fetchMock.mockResolvedValue(
      errorResponse(403, { code: 'REPORT_FORBIDDEN', message: 'Not permitted to export' }),
    );

    const failure = (await download('/reports/monthly.pdf').catch(
      (cause: unknown) => cause,
    )) as ApiError;
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.isForbidden).toBe(true);
    expect(failure.code).toBe('REPORT_FORBIDDEN');
    expect(click).not.toHaveBeenCalled();
  });
});
