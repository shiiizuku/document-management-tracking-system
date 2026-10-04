/**
 * One signed-in user, as the load test drives it: a cookie jar, the CSRF mirror, and a client
 * address of its own.
 *
 * ## Why each session sends its own `X-Forwarded-For`
 *
 * The API counts requests per signed-in user and, before sign-in, per client address — and the
 * address is `req.ip`, which is only the real client when `TRUST_PROXY` names the hop in front of
 * the API (PR #97). The load generator stands where the pilot's TLS ingress stands: one machine in
 * front of the API, speaking for many clients. So the API is started with `TRUST_PROXY=loopback`
 * and every session reports a distinct address, exactly as the ingress would report each desk.
 *
 * Without that, every sign-in would share one 5-a-minute window and the test would measure the
 * throttle rather than the server — the trap the D2 box warned about. With it, the throttle stays
 * switched on and stays honest: a session that genuinely exceeded 120 requests a minute would
 * still be refused, and the report counts those refusals apart from server errors.
 */

export interface Sample {
  label: string;
  ms: number;
  status: number;
  at: number;
}

export type Recorder = (sample: Sample) => void;

export class HttpError extends Error {
  constructor(
    readonly label: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`${label} answered ${status}: ${body.slice(0, 300)}`);
  }
}

export interface SessionAccount {
  id: string;
  email: string;
  password: string;
  role: string;
  divisionId: string | null;
  sectionId: string | null;
}

export class Session {
  readonly #cookies = new Map<string, string>();

  constructor(
    readonly account: SessionAccount,
    readonly clientAddress: string,
    private readonly baseUrl: string,
    private readonly record: Recorder,
  ) {}

  async login(): Promise<void> {
    await this.request('POST /auth/login', 'POST', '/auth/login', {
      json: { email: this.account.email, password: this.account.password },
    });
    if (!this.#cookies.has('dts_session'))
      throw new Error(`Signing in as ${this.account.email} set no session cookie`);
  }

  get<T>(label: string, path: string): Promise<T> {
    return this.request<T>(label, 'GET', path);
  }

  post<T>(label: string, path: string, json: unknown): Promise<T> {
    return this.request<T>(label, 'POST', path, { json });
  }

  upload<T>(label: string, path: string, name: string, bytes: Buffer): Promise<T> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), name);
    return this.request<T>(label, 'POST', path, { form });
  }

  private async request<T>(
    label: string,
    method: 'GET' | 'POST',
    path: string,
    body: { json?: unknown; form?: FormData } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { 'x-forwarded-for': this.clientAddress };
    if (this.#cookies.size > 0)
      headers.cookie = [...this.#cookies].map(([name, value]) => `${name}=${value}`).join('; ');
    const csrf = this.#cookies.get('dts_csrf');
    if (method !== 'GET' && csrf !== undefined) headers['x-csrf-token'] = csrf;
    if (body.json !== undefined) headers['content-type'] = 'application/json';

    const started = performance.now();
    let status = 0;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body.form ?? (body.json === undefined ? null : JSON.stringify(body.json)),
      });
      status = response.status;
      // The session is renewed on every authenticated request (P-10), so the jar follows it.
      for (const cookie of response.headers.getSetCookie()) {
        const [pair = ''] = cookie.split(';');
        const separator = pair.indexOf('=');
        if (separator > 0) this.#cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      // The body is read inside the timed span: a response is not served until it has arrived.
      const text = await response.text();
      if (!response.ok) throw new HttpError(label, status, text);
      return (text === '' ? undefined : (JSON.parse(text) as { data: T }).data) as T;
    } finally {
      this.record({ label, ms: performance.now() - started, status, at: Date.now() });
    }
  }
}
