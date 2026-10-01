# Document Management and Tracking System

A greenfield DTS implementation based on `docs/Document-management-tracking-system.md`. The repository uses npm workspaces, a NestJS modular API, a Next.js App Router client, shared Zod contracts, Drizzle/PostgreSQL migrations, Redis/BullMQ dependencies, MinIO object-storage infrastructure, and ClamAV infrastructure.

## Implemented vertical slice

- Secure cookie login with seeded development users and inactivity expiry.
- Server-enforced role, division, section, assignment, share, viewer, and confidential-record policy seams.
- Incoming/outgoing registration, generated tracking/reference numbers, authorized metadata search, filters, sorting, pagination, detail, and timeline.
- Full predefined workflow matrix, required revision remarks, optimistic version checks, allowed-actions API, release evidence invariant, archive, and restore.
- Immutable file-version domain service with SHA-256 checksums and fail-closed scan states.
- Persistent notification domain with unread/read state, cursor catch-up, and idempotency keys.
- Monthly report calculations, formula-injection-safe XLSX generation, PDF export, and routing-slip PDF.
- Append-only audit service boundary, stable error envelope, correlation IDs, health/readiness, CORS allowlist, Helmet, and OpenAPI UI.
- Responsive accessible operational UI with login, scoped metrics, registry/search, registration, workflow actions, and timeline.
- Drizzle schema/migration for organization, users, documents, workflow, routing, immutable files, notifications, audit, and outbox.
- Docker Compose development dependencies plus backup/restore and CI foundations.

## Quick start

The API is persisted to PostgreSQL and needs its infrastructure — there is no in-memory mode. It
also refuses to boot without a `.env`: `apps/api/src/config/environment.ts` validates every
required variable at startup.

Requirements: Node.js 22+, npm 11+, Docker Desktop. Budget roughly 4 GB of free memory — ClamAV's
definition database alone wants about 2 GB.

```bash
cp .env.example .env
npm install
npm run build -w @dts/contracts
docker compose up -d --build postgres redis minio clamav
npm run db:migrate
npm run db:seed
npm run dev
```

In a second terminal, start the background worker:

```bash
npm run dev:worker -w @dts/api
```

Then open:

- Web app — `http://localhost:3001`
- API base — `http://localhost:4001/api/v1`
- OpenAPI UI — `http://localhost:4001/api/docs`
- MinIO console — `http://localhost:9003`

Every published port is offset from its service's usual one so the stack can run beside another
project on the same machine. Each is overridable: `WEB_HOST_PORT`, `API_HOST_PORT`,
`POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `MINIO_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT` and
`CLAMAV_HOST_PORT`.

Sign in with any development account below.

### Things that will bite you once

- **Build the contracts first.** The `@dts/*` workspace symlinks resolve to `dist/`, so `typecheck`
  and both apps fail until `npm run build -w @dts/contracts` has run at least once.
- **`--build` is required on the first compose run.** MinIO is compiled from the vendored AGPL
  source in `./minio` because the published image is license-gated and denies S3 operations
  offline. It is a Go build: slow once, cached afterwards.
- **ClamAV is slow to go healthy.** Its healthcheck has a 90-second start period while definitions
  load. `docker compose ps` shows `starting` until then.
- **Run the worker, or attachments stay stuck.** `npm run dev` starts only the API and the web app.
  The worker drains the outbox and performs ClamAV scans, and downloads **fail closed** on any
  version that is not `CLEAN` — so without it, uploads succeed but can never be downloaded.
- **Port 5432 already in use?** Every host port is overridable: `POSTGRES_HOST_PORT=5433 docker
compose up -d postgres` (same pattern for `REDIS_HOST_PORT`, `MINIO_HOST_PORT`,
  `CLAMAV_HOST_PORT`, `API_HOST_PORT`, `WEB_HOST_PORT`).

### Everything in containers

To run the app processes in Docker as well — adding the one-shot `migrate` gate plus `api`,
`worker` and `web` — use the whole file instead of the four dependencies:

```bash
docker compose up -d --build
```

`api` waits for its four dependencies to be healthy **and** for `migrate` to exit successfully, so
it can never serve traffic against an un-migrated schema. Note that a clean-machine cold boot has
not yet been verified end to end (`docs/TO - IMPLEMENT.md`).

### Development accounts

`npm run db:seed` creates three users (`apps/api/src/database/seed.ts`):

| Role          | Email               | Password        | Placement                        |
| ------------- | ------------------- | --------------- | -------------------------------- |
| Administrator | `admin@dts.local`   | `Admin@12345!`  | none; confidential access        |
| Records Staff | `records@dts.local` | `Records@1234!` | Records Office / Intake          |
| Staff Member  | `staff@dts.local`   | `Staff@12345!`  | pilot division / General Section |

Override the administrator password with `SEED_ADMIN_PASSWORD`. There is no seeded viewer account;
create one by signing in as the administrator and posting to `/api/v1/users` with
`"role": "VIEWER"` (the admin UI for this is not built yet). Seeding uses `onConflictDoNothing`, so
re-running it will not reset a password on an existing user.

These credentials are synthetic local defaults and must never be reused in a pilot.

## Quality commands

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
docker compose config --quiet
```

## Architecture note

`docs/architecture.md` is the orientation document: the layers, the stack choices, and why each
one looks the way it does. The decisions behind the load-bearing ones live in `docs/adr/`.

The backend is feature-complete through phase 6 and persisted to Postgres — the old in-process
`Map`-backed adapter has been retired, and attachments, scanning, realtime and the outbox relay all
run against real infrastructure. The frontend is partially built and mid-rebuild on shadcn/ui
(`docs/frontend-rebuild-plan.md`). See `docs/IMPLEMENTATION_STATUS.md` for the exact boundary; the
repository does not claim pilot readiness.
