# ADR-0002: Signed JWT carried in an HTTP-only session cookie

- Status: Accepted
- Date: 2026-09-28
- Deciders: Engineering lead, Security reviewer

## Context

The web client (`apps/web`, Next.js App Router) and the API are separate origins in
development and may be separate origins in production. Users are staff on managed
workstations; sessions must expire on inactivity, and a stolen credential must not be
readable by page scripts.

Two axes had to be decided independently: **what the credential is** (opaque server
session vs. signed token) and **how it travels** (cookie vs. `Authorization` header).

## Decision

**Transport: an HTTP-only cookie**, `dts_session`, set at `POST /auth/login`
([auth.controller.ts:28](../../apps/api/src/modules/auth/auth.controller.ts:28)) and
cleared at `POST /auth/logout`. Cookie attributes come from validated environment
config — `COOKIE_SECURE`, `COOKIE_SAME_SITE`, `COOKIE_MAX_AGE_MS` — and
[environment.ts](../../apps/api/src/config/environment.ts) refuses to boot when
`NODE_ENV=production` with `COOKIE_SECURE=false`, or when `SameSite=None` is combined
with a non-secure cookie.

**Credential: a JWT** signed with `SESSION_SECRET` (minimum 32 characters, and never a value
published in the repository; both enforced at boot), expiring at `COOKIE_MAX_AGE_MS`. Passwords are verified with bcrypt before the
token is issued.

Because the credential is ambient, **CORS is an allowlist** (`WEB_ORIGIN`, comma-separated
and URL-validated at boot) with `credentials: true`, and state-changing routes require
CSRF protection (Phase 1).

## Consequences

- Page JavaScript cannot read the credential, which removes the largest XSS
  token-exfiltration path. This is the main reason a cookie beats `localStorage` +
  `Authorization` here.
- An ambient credential means CSRF becomes a real risk, paid for with `SameSite` plus an
  explicit CSRF token on mutations. That cost is accepted deliberately.
- The JWT is **stateless**, so logout clears the cookie but cannot invalidate an
  already-issued token before it expires. `COOKIE_MAX_AGE_MS` defaults to 30 minutes to
  bound that window. If revoking a single session becomes a requirement, a `session` table
  must be introduced and this ADR superseded — the schema already anticipates that in
  Phase 1's endpoint list.
- **Revoking every session of one user does not need that table** (added 2026-10-07, risk
  R-22). `AuthGuard` already re-reads the user on every request. Since migration 0014 the row
  also carries `session_version`, and each session carries the value it was issued under as
  its `sv` claim. A mismatch is refused like an expired session. A password change, an
  administrator reset, deactivation and reactivation each bump the counter, so one write ends
  all of that user's sessions. A token from before 0014 has no `sv` and reads as 0, which
  still matches until the first bump. It costs no extra query: the version is compared on the
  row the guard was already loading.
- Rotating `SESSION_SECRET` invalidates every live session. That is the intended break-glass
  control.

## Alternatives considered

- **Opaque server-side session ID + `session` table.** Rejected for Phase 1 only because
  it adds a database read to every request before any identity tables are persisted.
  Revisit if revocation becomes mandatory.
- **JWT in an `Authorization: Bearer` header.** Rejected: it requires storing the token
  somewhere script-readable, which trades a CSRF risk for a strictly worse XSS risk.
