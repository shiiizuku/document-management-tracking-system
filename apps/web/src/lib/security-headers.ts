/**
 * Response headers for every page the web app serves (D6, Phase 7).
 *
 * The policy is deliberately not a full script policy: Next.js inlines its bootstrap scripts, and
 * a `script-src` without nonces would either break hydration or need `'unsafe-inline'`, which
 * buys nothing. What it does constrain is what matters for this app:
 *
 * - `frame-ancestors 'none'` — no other site may frame the registry and click on a user's behalf.
 * - `connect-src` — the page, and the `blob:` preview frames it creates (which inherit this
 *   policy), may talk only to this origin and the API. That is the outbound-request limit
 *   `inline-file-pane.tsx` says the API's own CSP cannot give a blob URL.
 * - `object-src blob:` — Chrome's PDF viewer is an embedded plugin and is blocked by `'none'`, which
 *   the `blob:` preview frame inherits; only this page's own blob URLs may be plugin content.
 * - `base-uri 'self'`, `form-action 'self'` — the usual injection footholds.
 */
/** Development only: the API's scheme and port on any host. An implicit port stays implicit. */
const anyHost = (api: URL): string => {
  const port = api.port === '' ? '' : `:${api.port}`;
  const socketScheme = api.protocol === 'https:' ? 'wss:' : 'ws:';
  return ` ${api.protocol}//*${port} ${socketScheme}//*${port}`;
};

export const securityHeaders = (
  apiUrl: string,
  { development = false }: { development?: boolean } = {},
): { key: string; value: string }[] => {
  const api = new URL(apiUrl);
  // Socket.IO upgrades to a WebSocket on the API's host; name the scheme explicitly rather than
  // relying on the CSP3 http→ws match.
  const socket = `${api.protocol === 'https:' ? 'wss:' : 'ws:'}//${api.host}`;
  const policy = [
    "default-src 'self'",
    // React's dev build rebuilds callstacks with eval(); production never does.
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Development follows the page's host (see `resolveApiUrl` in api.ts), so any host on the API's
    // port is allowed; production names exactly the one configured origin.
    `connect-src 'self' ${api.origin} ${socket}${development ? anyHost(api) : ''}`,
    "frame-src 'self' blob:",
    'object-src blob:',
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    { key: 'Content-Security-Policy', value: policy },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    // Ignored over plain HTTP, so harmless locally; behind the pilot's TLS ingress it pins HTTPS.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  ];
};
