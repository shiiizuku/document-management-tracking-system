# Phase 1 — Identity & Organization — Completion Report

**Date:** 2026-09-29
**Scope reference:** `docs/TO - IMPLEMENT.md` → *Phase 1 — Identity & Organization*
**Branch / commit:** `main` lineage, PR #39 (latest `c8abcfe`); backend at `a92a575`, integration tests at `c8abcfe`.

## Verdict

**Backend complete and verified end-to-end against Postgres. One item — the frontend
identity/admin UI — remains before Phase 1 is fully closed.**

The Identity, Authentication/Session, Authorization, Organization, Account-request and Audit
backend is implemented and covered by fast unit/service tests **and** by HTTP + Postgres
integration tests (added in `c8abcfe`). The two integration gaps this report originally
flagged as the gate before Phase 2 are now closed:

- ✅ **Integration verification** — `identity.int.test.ts` boots the app against a real
  database and drives the account lifecycle over HTTP (controllers, validation, guards, DB
  transactions, policies).
- ✅ **`query-scope.ts`** — `query-scope.int.test.ts` proves `documentScopeFor` against real
  Postgres across all actor kinds (division/section/assignment/share/confidentiality).

Remaining:

1. **Frontend identity/admin UI** is largely unbuilt (login/logout exist; the account-request
   form, admin user table, approve/reject dialogs, division/section manager and profile-photo
   upload do not). Note the dependency-aware roadmap in `docs/CONTEXT.md` places most UI on the
   **Phase 3 (Weeks 10–13)** track; whether this UI is a Phase 1 exit criterion or Phase 3 work
   is an open sequencing decision, not a defect.

## Quality gate (as of `c8abcfe`)

| Check | Result |
| --- | --- |
| `npm test -w @dts/api` (unit) | **193 passing / 0 failing** (24 files) |
| `npm run test:integration -w @dts/api` (Postgres) | **10 passing / 0 failing** (4 files) |
| `npm run typecheck -w @dts/api` | **0 errors** |
| `npx eslint apps/api` + Prettier | **clean** |
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

| # | Gap | Severity | Status |
| --- | --- | --- | --- |
| 1 | **Frontend identity/admin UI** | High | **Open.** `apps/web` has login/logout and a document dashboard only. Missing: request-account form, admin user table, approve/reject dialogs, division/section manager, profile + photo upload, explicit session-expired handling. `docs/CONTEXT.md` places most UI on the Phase 3 track — sequencing decision pending. |
| 2 | **HTTP/DB integration tests for identity, org, account-request, user-admin endpoints** | High | **Closed** in `c8abcfe` — `identity.int.test.ts` drives the lifecycle over HTTP against real Postgres (controllers, Zod validation, guards, transactions). |
| 3 | **`authorization/query-scope.ts` untested** | Medium | **Closed** in `c8abcfe` — `query-scope.int.test.ts` proves `documentScopeFor` against real Postgres across all actor kinds. |
| 4 | **"Done when" not fully evidenced** | Medium | **Closed** for the backend — "no list/count endpoint leaks data" is now proven end-to-end over HTTP (deny-by-default on the admin queue and user list) and at the SQL layer (query-scope). Remaining evidence is UI-side only (#1). |
| 5 | **Sessions table** | Low | **N/A by design** — schema lists `session (if server sessions)`; implementation uses stateless JWTs per ADR-0002, so there is intentionally no session table. |

## Environment notes (will bite the next session)

- `node_modules/@dts/*` are npm-workspace symlinks that have been found **dangling** (pointing
  at a stale path). This breaks `tsc` typecheck (`Cannot find module '@dts/contracts'`) but not
  vitest (which aliases to source). Fix: `npm run build -w @dts/contracts`, then repoint the
  symlinks to this checkout. `npm test` passing does **not** imply typecheck passes — run it
  separately.
- The unit suite runs **without Postgres/Redis/MinIO**; identity/auth DB access is overridden
  with in-memory doubles. Integration tests (`*.int.test.ts`) need Postgres and are excluded
  from the default run — invoke with `npm run test:integration -w @dts/api`, with `DATABASE_URL`
  pointing at a **disposable** database and `ALLOW_DATABASE_RESET=true` (they drop/recreate
  `public`). App-config env is supplied by `test/setup-int-env.ts`. The booted app needs only
  Postgres at startup, matching the CI integration job.

## Gate before Phase 2 — satisfied

Phase 2 (Document registry) depends on the authorization predicates and scope enforcement from
Phase 1. The recommended gate (integration items #2 and #3) is now **closed**: the scope
guarantees the document endpoints will reuse are proven against a real database, not in-memory
mocks. The only open Phase 1 item is the frontend identity/admin UI (#1), which does not block
Phase 2 backend work and may be scheduled on the Phase 3 UI track.
The frontend (#1) can proceed in parallel or on the Phase 3 UI track, but should not be
silently dropped from Phase 1's acceptance.
