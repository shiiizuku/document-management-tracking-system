/**
 * The one seam between the browser and the API.
 *
 * Everything the client knows about talking to the server lives here: credentials, the CSRF
 * double-submit header, the `{ data }` / `{ error }` envelope, 204s, non-JSON failures, and the
 * blob dance a file download needs. Screens call `api()` or `download()` and handle `ApiError`;
 * they never see a header, an envelope or an object URL. Tests replace this module and nothing
 * else.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Methods the server treats as state-changing, and so require the CSRF header. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** The server mirrors the request's correlation ID onto every response, including failures. */
const CORRELATION_ID_HEADER = 'x-correlation-id';

/** Shape of `details` when the server's Zod pipe rejects a body (`error.flatten()`). */
interface ValidationDetails {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
}

/** The failure envelope written by the API's HttpErrorFilter. */
interface ErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    correlationId?: string;
  };
}

/**
 * A failed request, carrying everything the server chose to disclose.
 *
 * `code` is the stable machine-readable string (`VALIDATION_FAILED`, `HTTP_409`, …) that callers
 * branch on instead of matching message text, and `correlationId` is what a user quotes to
 * support. The field accessors below keep the server's Zod `flatten()` shape known only here, so
 * forms bind to errors without learning the envelope.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly correlationId: string | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    correlationId?: string | null;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.correlationId = init.correlationId ?? null;
  }

  /** The session is gone or expired: clear cached data and send the user back to sign in. */
  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  /** Authenticated but not permitted. Distinct from 401: re-authenticating will not help. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** Optimistic-concurrency conflict: the record moved on, so refetch before retrying. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** Per-field messages for a rejected form, keyed by field name. Empty when not a validation error. */
  get fieldErrors(): Record<string, string[]> {
    const raw = (this.details as ValidationDetails | undefined)?.fieldErrors;
    if (!raw) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string[]] => Boolean(entry[1])),
    );
  }

  /** Validation messages that belong to the form as a whole rather than one field. */
  get formErrors(): string[] {
    return (this.details as ValidationDetails | undefined)?.formErrors ?? [];
  }
}

/**
 * Reads the JS-readable CSRF cookie the server mirrors the session token into. The double-submit
 * guard compares this header against the signed session claim, so every mutation must echo it.
 */
const csrfToken = (): string | null => {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'dts_csrf') return decodeURIComponent(rest.join('='));
  }
  return null;
};

const request = async (path: string, init: RequestInit): Promise<Response> => {
  const method = (init.method ?? 'GET').toUpperCase();
  const csrf = UNSAFE_METHODS.has(method) ? csrfToken() : null;
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...init.headers,
    },
  });
};

/**
 * Builds the error for a non-2xx response.
 *
 * A failure is not guaranteed to be our envelope — a proxy or gateway can return HTML, and a
 * dropped connection returns nothing at all. Parsing defensively keeps the real status visible
 * instead of surfacing a JSON SyntaxError from the parse itself.
 */
const errorFrom = async (response: Response): Promise<ApiError> => {
  const headerCorrelationId = response.headers.get(CORRELATION_ID_HEADER);
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    // Not our envelope (gateway HTML, an empty body): fall back to the status line below.
  }
  const error = envelope?.error;
  return new ApiError({
    status: response.status,
    code: error?.code ?? `HTTP_${response.status}`,
    message: error?.message ?? response.statusText ?? 'Request failed',
    details: error?.details,
    correlationId: error?.correlationId ?? headerCorrelationId,
  });
};

/** Issues a JSON request and unwraps the success envelope. Throws {@link ApiError} on failure. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await request(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw await errorFrom(response);
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as { data?: T };
  return payload.data as T;
}

/**
 * Parses the filename the server chose. Prefers RFC 5987 `filename*` (which carries non-ASCII
 * names) over the plain `filename`, and keeps only the basename so a crafted header cannot steer
 * the save anywhere but the download folder.
 */
const filenameFrom = (disposition: string | null): string | null => {
  if (!disposition) return null;
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const raw = extended === undefined ? plain : decodeURIComponent(extended);
  const base = raw?.split(/[\\/]/).pop()?.trim();
  return base ? base : null;
};

/**
 * Downloads a binary response (PDF, XLSX, an attachment) and hands it to the browser to save.
 *
 * `api()` cannot serve these: it always parses JSON. Failures still arrive as the JSON envelope,
 * so they surface as a normal {@link ApiError} and callers treat both paths alike. Returns the
 * filename used, which the server names via Content-Disposition; `fallbackFilename` applies only
 * when it does not.
 */
export async function download(path: string, fallbackFilename = 'download'): Promise<string> {
  const response = await request(path, { method: 'GET' });
  if (!response.ok) throw await errorFrom(response);

  const filename = filenameFrom(response.headers.get('content-disposition')) ?? fallbackFilename;
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoking immediately is safe: the click has already handed the blob to the browser.
    URL.revokeObjectURL(url);
  }
  return filename;
}
