# Phase 1 — Identity & Organization — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → *Phase 1 — Identity & Organization*
**Branch / commit:** `main` @ `a92a575` (*feat(identity): Phase 1 Identity & Organization, hardened test-first*)

## Verdict

**Backend: complete and verified at the unit/service level. Overall Phase 1: not yet closed.**

The Identity, Authentication/Session, Authorization, Organization, Account-request and
Audit backend is implemented and now covered by fast, mutation-checked tests. Two areas of
the Phase 1 definition remain open and should be treated as carry-over into (or a gate before)
the next phase:

1. **Frontend tasks** for the slice are largely unbuilt (login/logout exist; the admin/identity
   UI does not).
2. **Integration verification** against real Postgres and over HTTP for the identity/org/
   account-request endpoints is absent — the current tests exercise these through mocks and an
   in-memory adapter, not a live database or the full request pipeline.

Do not read the green suite as "the endpoints are proven end-to-end." It proves the domain
logic and policies are correct in isolation.

## Quality gate (as of this commit)

| Check | Result |
| --- | --- |
| `npm test -w @dts/api` (vitest) | **193 passing / 0 failing** (24 files) |
| `npm run typecheck -w @dts/api` | **0 errors** |
| `npx eslint apps/api` | **clean** |
| Mutation check on all new/changed code | every mutation turned a test red (no survivors) |

Starting point for this work was **13 failing tests**; the failures were stale tests and a
mis-wired rate limiter left by an in-progress refactor (see *Defects fixed*).

## What was delivered

### Backend — implemented and tested

- **Authentication & session** (`auth.service.ts`, `session.service.ts`, `auth.guard.ts`,
  `csrf.guard.ts`)
  - bcrypt verification with a constant-time dummy-hash path so unknown addresses and wrong
    passwords are indistinguishable; single generic credential error.
  - Per-account lockout after N failed attempts; a locked account is refused even with the
    correct password.
  - Stateless JWT session (ADR-0002) with an **inactivity window** and an **absolute cap**;
    CSRF token bound into the session claim and mirrored in a JS-readable cookie
    (double-submit). Cookie issue/clear flags mirror correctly.
  - No-credentials-in-logs: failed logins record only a pseudonymized email digest, never the
    address or password.
- **Rate limiting** — login capped (5/min) and account-request capped (3/min) via per-route
  overrides of a single default bucket.
- **Authorization** (`authorization.service.ts`, `identity.policies.ts`, `policy.ts`,
  `role-capabilities.ts`) — deny-by-default capability + scope model with a table-driven
  matrix over 5 roles, including cross-division, guessed-ID, self-deactivate and unknown-action
  negatives.
- **Organization** (`organization.service.ts`) — division/section CRUD with authz gates,
  admin-sees-retired-divisions, and `resolvePlacement` membership rules (role→placement
  requirements, section-belongs-to-division, inactive-division rejection).
- **Account requests & users** (`identity.service.ts`) — self-service submit with
  existence-oracle protection; approve (authz + already-reviewed guard + atomic
  user/request/audit/outbox creation, returns a user without its password hash); reject;
  create/update/deactivate/reactivate with last-administrator protection.
- **Audit** wired into auth and admin actions; append-only writer boundary.
- **Schema & migrations** — `division`, `section`, `users` (with lockout columns),
  `account_request`, `role`/capabilities, plus `0001_identity_and_organization` and
  `0002_drop_profile_photo_object_key` migrations.

### Tests added this cycle

`rate-limit.test.ts`, `session.service.test.ts`, `csrf.guard.test.ts`,
`authorization.service.test.ts` (the matrix), `organization.service.test.ts`,
`identity.account-requests.test.ts`, `in-memory-audit.writer.ts`; and repaired
`auth.service.test.ts`, `auth.guard.test.ts`, `in-memory-users.repository.ts`,
`users.repository.test.ts`, `api.test.ts`, `file-api.test.ts`.

### Defects fixed

- **Global throttling bug** — under `@nestjs/throttler` v6 every *named* throttler applies to
  every route, so the account-request (3/min) bucket was rate-limiting the whole API (workflow
  actions 429'd on the 4th call). Reworked to one default bucket with per-route overrides.
- Stale post-refactor tests (wrong `AuthService`/`AuthGuard` constructor arity, obsolete
  `profilePhotoObjectKey` fixtures) and full-app login 500s (DB-backed audit writer not
  overridden in no-DB suites).

## Outstanding for Phase 1 (carry-over)

| # | Gap | Severity | Notes |
| --- | --- | --- | --- |
| 1 | **Frontend identity/admin UI** | High | `apps/web` has login/logout and a document dashboard only. Missing: request-account form, admin user table, approve/reject dialogs, division/section manager, profile + photo upload, explicit session-expired handling. Listed under Phase 1 "Frontend tasks". |
| 2 | **HTTP/DB integration tests for identity, org, account-request, user-admin endpoints** | High | Currently unit/service + in-memory only. The controllers, Zod validation wiring, guards on those routes, and DB transactions are not exercised end-to-end. `migration.int.test.ts` proves migrations run; the identity behaviors are not run against Postgres. |
| 3 | **`authorization/query-scope.ts` untested** | Medium | `documentScopeFor`/`scopeToActor` (the SQL twin of the read policy) has no test — its own comment references a `query-scope.int.test.ts` that does not exist. A pure-unit test on Drizzle SQL objects would be a change-detector; correctness needs a Postgres integration test. This underpins "no list/detail/count endpoint leaks data." |
| 4 | **"Done when" not fully evidenced** | Medium | Matrix passes positive+negative ✅. "No list/detail/count/admin endpoint leaks data" is verified at the policy/service layer, **not** proven end-to-end over HTTP with a real DB (depends on #2/#3). |
| 5 | **Sessions table** | Low | Schema lists `session (if server sessions)`; implementation uses stateless JWTs per ADR-0002, so there is intentionally no session table. Noted so it is not mistaken for a missing item. |

## Environment notes (will bite the next session)

- `node_modules/@dts/*` are npm-workspace symlinks that have been found **dangling** (pointing
  at a stale path). This breaks `tsc` typecheck (`Cannot find module '@dts/contracts'`) but not
  vitest (which aliases to source). Fix: `npm run build -w @dts/contracts`, then repoint the
  symlinks to this checkout. `npm test` passing does **not** imply typecheck passes — run it
  separately.
- The API test suite runs **without Postgres/Redis/MinIO**; identity/auth DB access is
  overridden with in-memory doubles. Integration tests (`*.int.test.ts`) need live services and
  are excluded from the default run.

## Recommended gate before Phase 2

Phase 2 (Document registry) depends on the authorization predicates and scope enforcement from
Phase 1. Before building on them, close **#2 and #3** at minimum, so the scope guarantees the
document endpoints will reuse are proven against a real database rather than in-memory mocks.
The frontend (#1) can proceed in parallel or on the Phase 3 UI track, but should not be
silently dropped from Phase 1's acceptance.
