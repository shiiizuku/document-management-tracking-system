# Phase 0 completion report

_Audited: 2026-09-29. Source: Phase 0 of the "DTS Developer Assignment — Vertical Slices by Phase"
brief (held outside the repo)._

Phase 0 has three slices. **0.2 and 0.3 are complete for the engineering deliverables; 0.1 is
blocked on inputs that cannot come from the repository.** This report records what exists, where to
find it, and what is deliberately left undone.

| Slice | Theme                            | Verdict                                       |
| ----- | -------------------------------- | --------------------------------------------- |
| 0.1   | Source alignment & risk register | ❌ **Not started** — writing task, tracked only |
| 0.2   | Architecture & dev experience    | ✅ **Done**                                    |
| 0.3   | Persistence & ops skeleton       | ✅ **Done** for the skeleton; wiring continues in Slice 0/M1 |

Verification at the time of writing: `npm run quality` green end to end — Prettier, ESLint
(`--max-warnings=0`), three TypeScript projects typechecked, **105 tests passing** (102 API, 1 web,
2 contracts), and all three workspace builds succeeding.

---

## Slice 0.1 · Source alignment & risk register — not started

Three documents are required. None is written, **by explicit decision** — they are authoring work
rather than engineering work, and are being deferred to a dedicated session. They are tracked as
open boxes in [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) under
_"Slice 0.1 · Source-alignment documents"_.

| Deliverable                  | State      | Notes                                                        |
| ---------------------------- | ---------- | ------------------------------------------------------------ |
| Traceability matrix          | ⬜ Not written | 75 user stories → D-1–D-151 → MVP/deferred → area → test  |
| Initial acceptance scenarios | ⬜ Not written | Incoming→archive journey + outgoing release path, given/when/then |
| Risk register                | ✅ Written 2026-10-07 | [`risk-register.md`](risk-register.md); every risk owned by the project lead |

**What already exists to build them from:** the decision register D-1–D-151, the MVP boundary, and
the policy gates in [`CONTEXT.md`](CONTEXT.md), plus [`policy-register.md`](policy-register.md).

**Why this is blocked rather than merely pending.** The brief treats these three documents as a
sign-off gate for the whole programme, but the gate cannot be closed from the codebase alone: the
risk register needs a named owner per risk, and the unresolved policy questions (records policy,
branding, reference format, SLA calendar, signature meaning, file allow-list and limits, retention)
need a decision from the records office. Treat Slice 0.1 as **blocked on those two inputs**, not as
remaining engineering effort.

---

## Slice 0.2 · Architecture & dev experience — done

| Deliverable                | Where                                                              |
| -------------------------- | ------------------------------------------------------------------ |
| Monorepo with workspaces   | root `package.json` → `apps/api`, `apps/web`, `packages/contracts`  |
| Modular-monolith API       | `apps/api` — NestJS 12, versioned at `/api/v1`                      |
| Web client                 | `apps/web` — Next.js 16 App Router                                  |
| Shared contracts           | `packages/contracts` — Zod schemas consumed by both sides           |
| Toolchain                  | TypeScript project refs, ESLint flat config (`recommendedTypeChecked`), Prettier, Vitest, Husky |
| Local infrastructure       | `docker-compose.yml` — Postgres, Redis, MinIO, ClamAV, each healthchecked |
| Architecture decisions     | `docs/adr/0001`–`0004` + `docs/adr/README.md`                       |
| One-command quality gate   | `npm run quality`                                                   |

### Fix applied in this pass: CI was red on a clean checkout

`@dts/contracts` publishes its types from `dist/`, but had no script to build them on install. CI
runs `npm ci → format:check → lint → typecheck → test → build`, so **lint ran before anything had
built `dist/`**. With the contracts types unresolvable, `@typescript-eslint`'s type-aware rules
degraded every cross-package import to `any` and emitted **45 `no-unsafe-*` errors** — a clean clone
could not pass CI.

The fix is one line in `packages/contracts/package.json`:

```json
"prepare": "npm run build"
```

npm runs `prepare` automatically for workspace packages after `npm ci`/`npm install`, so `dist/`
exists before any consumer is linted. Verified by deleting `dist/` and reinstalling — `index.js` and
`index.d.ts` reappear, and `npm run quality` is green.

`apps/api` also gained an explicit `zod` dependency. It imports `zod` directly in
`common/zod-validation.pipe.ts` but was resolving it transitively through `@dts/contracts`, which
works by accident of hoisting and breaks the moment the contracts package changes its own dependency.

---

## Slice 0.3 · Persistence & ops skeleton — done

### Configuration boundary

`apps/api/src/config/environment.ts` exports `validateEnvironment`, wired into
`ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment })` in `app.module.ts`.
Because `@nestjs/config` runs `validate` during module resolution, **bad configuration fails at
boot** rather than at first use.

It validates connection URLs by protocol (`postgresql:`/`postgres:`, `redis:`/`rediss:`,
`http:`/`https:`), the S3 bucket-name grammar, and cookie coherence — `COOKIE_SECURE` must be true in
production, and must be true whenever `COOKIE_SAME_SITE=none`, since browsers reject that combination
outright. `SESSION_SECRET` must be at least 32 characters.

> **Known trade-off.** `DATABASE_URL`, `REDIS_URL`, `MINIO_*`, and `CLAMAV_HOST` are required
> **unconditionally**, not just in production. This means the API will not boot without those
> variables present, which conflicts with the README's "Option A" no-infrastructure path. Either
> relax these to production-only, or drop Option A from the README — the two documents currently
> disagree.

### Observability

| Concern            | Implementation                                                   |
| ------------------ | ---------------------------------------------------------------- |
| Structured logging | `common/structured-logger.ts` — one JSON object per line, installed via `app.useLogger()` |
| Correlation IDs    | `common/correlation-id.middleware.ts` + `common/request-context.ts` (AsyncLocalStorage) |
| Log redaction      | `redact()` strips secret-shaped keys and inline `key=value` pairs |
| Level control      | `LOG_LEVEL` env var, `info` by default                           |

The correlation ID is read from request-scoped `AsyncLocalStorage` rather than threaded through
call signatures, so every log line emitted while handling a request carries the same
`correlationId` without any caller passing it along. That is what makes the logs joinable per
request once they reach a collector.

### Readiness vs liveness

`modules/health/health.controller.ts` separates the two probes, because conflating them makes an
orchestrator restart a perfectly healthy API every time Postgres blips:

- `GET /health` — liveness. Touches **no** dependency. A test asserts the injected database is never
  called.
- `GET /ready` and `GET /health/ready` — readiness. Runs `select 1` through the injected `DATABASE`
  token, under a 2-second `Promise.race` timeout so a hung socket cannot hang the probe. Returns
  `{ status: 'ready', checks: { database: 'up' } }`, or throws `ServiceUnavailableException` with
  code `NOT_READY` and `details.checks` when a dependency is down. Both paths exist so the compose
  healthcheck and an orchestrator can each use their preferred URL.

**Security constraint held deliberately.** Readiness is unauthenticated, so the response body
carries dependency **names and states only** — never driver error text. Leaking a raw
`connect ECONNREFUSED 10.0.0.5:5432` would disclose internal network topology to anonymous callers.
The driver detail is logged server-side instead, and a regression test asserts the error string never
appears in the response. `HttpErrorFilter`'s masking of all 5xx bodies was **not** weakened to make
this endpoint more informative.

### Persistence spine

`database/database.module.ts` is a `@Global()` module providing two tokens: `DATABASE_CONNECTION`
(the pool, built from `DATABASE_URL` via `ConfigService`) and `DATABASE` (the Drizzle instance).
A `DatabaseShutdown` provider implements `OnApplicationShutdown` to call `pool.end()`, so the
process does not leak connections on restart.

Consumers today: `UsersRepository` (`modules/users/users.repository.ts`) over the `users` table,
`AuthService`/`AuthGuard` resolving users through it, and the readiness probe. The schema itself
covers 18 tables and 7 enums with uuid primary keys, a shared timestamps helper,
`documents.version` for optimistic concurrency, `audit_events.correlation_id`, and `outbox_events`
with a unique idempotency key — plus migration `0000` and a seed script.

---

## What Phase 0 does **not** deliver

Recorded so the next session does not mistake these for finished work:

- **Documents, files, notifications, and reports are still `Map`-backed** in
  `modules/application/dts-application.service.ts`. Only identity reads from Postgres.
- **Redis/BullMQ, MinIO, and ClamAV are configured and validated but never imported** at runtime.
  The outbox table has no writer and no relay.
- **Readiness probes Postgres only.** Redis and object storage are not yet checked — tracked in M6.
- **CI does not provision Postgres**, so the DB-backed integration tests do not run there.
- **Slice 0.1's three documents are unwritten** (see above).

---

## Change log for this pass

| Change                                                            | File                                    |
| ----------------------------------------------------------------- | --------------------------------------- |
| Added `prepare` so `dist/` builds on install — unblocks CI lint    | `packages/contracts/package.json`       |
| Declared the direct `zod` dependency                              | `apps/api/package.json`                 |
| Ticked the readiness box; corrected the infrastructure verdict table and the stale "all `Map`-backed" claim; refreshed the audit date | `docs/IMPLEMENTATION_STATUS.md` |
| Added the Slice 0.1 section as **tracked but unwritten**, with the blocked-on-inputs gate | `docs/IMPLEMENTATION_STATUS.md` |
| This report                                                       | `docs/PHASE_0_REPORT.md`                |
