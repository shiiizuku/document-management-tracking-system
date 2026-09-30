export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

/** Methods the server treats as state-changing, and so require the CSRF header. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const csrf = UNSAFE_METHODS.has(method) ? csrfToken() : null;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const payload = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new ApiError(payload.error?.message ?? 'Request failed', response.status);
  return payload.data as T;
}
