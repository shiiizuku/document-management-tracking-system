# Document Management and Tracking System

A greenfield DTS implementation based on `docs/Document-management-tracking-system.md`. The repository uses npm workspaces, a NestJS modular API, a Next.js App Router client, shared Zod contracts, Drizzle/PostgreSQL migrations, Redis/BullMQ dependencies, MinIO object-storage infrastructure, and ClamAV infrastructure.

## Tech stack

The repository is an npm-workspaces monorepo with four packages: `apps/api`, `apps/web`,
`apps/e2e` and `packages/contracts`. Each layer below lists its pieces and the job each one does.

### Language and shared code

| Technology                 | Core function                                                                                                                                |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript**             | The one language across the API, the web app, the tests and the shared contracts, so a type change breaks every caller at compile time.      |
| **Node.js 22+**            | The runtime for the API, the background worker, the Next.js server and every script.                                                         |
| **Zod** (`@dts/contracts`) | Shared request/response schemas. The API validates input with them and the web app types its calls with them, so the two cannot drift apart. |
| **npm workspaces**         | Links the four packages together and runs `build`, `test` and `typecheck` across all of them from the root.                                  |

### Backend — `apps/api`

| Technology                                       | Core function                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| **NestJS**                                       | The application framework: modules, controllers, dependency injection and guards that structure the REST API. |
| **Express** (`@nestjs/platform-express`)         | The HTTP server underneath NestJS.                                                                            |
| **Drizzle ORM** + **drizzle-kit**                | Type-safe SQL queries and the schema definition; drizzle-kit generates the versioned SQL migrations.          |
| **pg** (node-postgres)                           | The PostgreSQL driver Drizzle runs on.                                                                        |
| **BullMQ** + **ioredis**                         | The job queue the worker consumes: it drains the transactional outbox and runs virus scans with retries.      |
| **Socket.IO** (`@nestjs/websockets`)             | Pushes realtime notifications to signed-in browsers.                                                          |
| **minio** (client)                               | Reads and writes attachment files in the S3-compatible object store.                                          |
| **multer** + **file-type**                       | Accepts multipart uploads and checks a file's real type from its bytes, not its extension.                    |
| **@nestjs/jwt**, **cookie-parser**, **bcryptjs** | Session tokens in secure cookies, and password hashing.                                                       |
| **helmet**, **@nestjs/throttler**                | Security headers, and per-client rate limits (including the login window).                                    |
| **class-validator** / **class-transformer**      | DTO validation and conversion at the controller boundary.                                                     |
| **@nestjs/swagger**                              | Generates the OpenAPI document and the interactive API docs at `/api/docs`.                                   |
| **pdfkit**, **fflate**                           | Generate PDF exports (reports, routing slips) and build XLSX workbooks for monthly reports.                   |
| **@nestjs/config**, **dotenv**                   | Load and validate environment configuration at startup; the API refuses to boot with a missing variable.      |

### Frontend — `apps/web`

| Technology                                                 | Core function                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Next.js** (App Router)                                   | The web framework: routing, layouts and server rendering of the operational UI.               |
| **React**                                                  | The component model every screen is built from.                                               |
| **Tailwind CSS**                                           | Utility-first styling and the design tokens behind light/dark themes.                         |
| **shadcn/ui** on **Radix UI**                              | Accessible, unstyled primitives (dialogs, menus, selects) composed into the app's components. |
| **TanStack Query**                                         | Fetches, caches and refreshes server data, and keeps lists in sync after mutations.           |
| **React Hook Form** + **@hookform/resolvers**              | Form state, with the shared Zod schemas as validators.                                        |
| **socket.io-client**                                       | Receives realtime notifications from the API.                                                 |
| **sonner**, **lucide-react**, **cmdk**                     | Toast messages, icons, and the command palette.                                               |
| **clsx**, **tailwind-merge**, **class-variance-authority** | Compose and de-duplicate class names, and define component variants.                          |

### Infrastructure — `docker-compose.yml`

| Service                        | Core function                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| **PostgreSQL 16**              | The system of record: organisation, users, documents, workflow, routing, file versions, notifications, the audit log and the outbox. |
| **Redis 7**                    | The backing store for BullMQ jobs, and the pub/sub channel that relays worker events to realtime clients.                            |
| **MinIO**                      | S3-compatible object storage for attachment files, built from the vendored source in `./minio`.                                      |
| **ClamAV**                     | Scans every uploaded file; a file can be downloaded only once it is marked `CLEAN`.                                                  |
| **migrate**                    | A one-shot container that applies database migrations before the API starts.                                                         |
| **api** / **worker** / **web** | The REST API, the background job processor, and the Next.js web app.                                                                 |

### Testing and tooling

| Technology                                 | Core function                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| **Vitest**                                 | Unit and integration tests for the API, the web app and the contracts.         |
| **Testing Library** + **jsdom**            | Renders React components in tests and asserts on what a user would see.        |
| **Supertest**                              | Drives the API over HTTP in integration tests.                                 |
| **Playwright** + **axe-core** (`apps/e2e`) | End-to-end tests through a real browser, plus automated accessibility checks.  |
| **ESLint** + **typescript-eslint**         | Static analysis; CI fails on any warning.                                      |
| **Prettier**                               | Code formatting.                                                               |
| **Husky** + **lint-staged**                | A pre-commit hook that formats and lints the staged files.                     |
| **Docker Compose**                         | Runs the development dependencies and the full production stack from one file. |

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
# Replace SESSION_SECRET in .env with the output of this. The API refuses the placeholder.
node -e "console.log(require('crypto').randomBytes(36).toString('base64'))"
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

### Production stack (Docker)

The whole system — Postgres, Redis, MinIO, ClamAV, a one-shot `migrate` job, `api`, `worker` and
`web` — runs from the one `docker-compose.yml`. Compose reads `.env` from the repository root for
every `${...}` in that file, so production is configured there and nothing in the compose file
needs editing.

Requirements on the host: Docker Engine 28 or later (earlier engines do not enforce the loopback-only
port binding below against hosts on the same network segment) with Compose v2.24.4 or later, about 4 GB of free memory (ClamAV alone
wants about 2 GB), and a reverse proxy that terminates HTTPS in front of the web and API ports.

**1. Get the code with LF line endings.** On Windows, check out with `git config core.autocrlf
false` or rely on the repository's `.gitattributes`. `infra/clamav/clamd.conf` is mounted into a
Linux container, and a CRLF copy stops clamd from starting (see
[Uploads stuck on "scan pending"](#uploads-stuck-on-scan-pending)).

**2. Write `.env`.** Start from `.env.example` and set at least:

| Variable                                | Production value                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------- |
| `NODE_ENV`                              | `production`                                                                            |
| `COOKIE_SECURE`                         | `true`. The API refuses to boot in production without it, so the site must be on HTTPS  |
| `SESSION_SECRET`                        | 32+ random characters, e.g. `openssl rand -base64 48`                                   |
| `POSTGRES_PASSWORD`                     | a strong password (`POSTGRES_USER` and `POSTGRES_DB` are optional)                      |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | new credentials; the secret must be 8+ characters                                       |
| `WEB_ORIGIN`                            | the public URL of the web app, e.g. `https://dts.example.gov.ph`. CORS allows only this |
| `PUBLIC_API_URL`                        | the public API base the browser calls, e.g. `https://dts.example.gov.ph/api/v1`         |
| `SEED_ADMIN_PASSWORD`                   | the first administrator's password. Required: the seed refuses to run without it        |
| `TRUST_PROXY`                           | `1` for one reverse proxy, or its IP/CIDR. Required behind HTTPS termination, see below |

`PUBLIC_API_URL` is compiled into the web bundle, so changing it later means rebuilding `web`.

`TRUST_PROXY` tells the API which hop in front of it may report the real client address through
`X-Forwarded-For`. Left unset (the default, right for local work) every request appears to come
from the reverse proxy, so the whole office shares one 120/min rate-limit bucket and one 5/min
login window, and login audit events record the proxy's address. `true` is refused at boot,
because it would trust an address the client wrote itself.

**3. Build and start.** Use the production overlay from the first command: the base file publishes
Postgres, Redis, MinIO and ClamAV on every host interface, and the overlay leaves them unpublished and
binds `api` and `web` to 127.0.0.1 only. To make every `docker compose` command on this host (including
the runbooks') use it, add `COMPOSE_FILE=docker-compose.yml:docker-compose.production.yml` to `.env`
(on Windows the separator is `;`: `COMPOSE_FILE=docker-compose.yml;docker-compose.production.yml`);
the commands below spell it out.

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build
```

Verified cold on 2026-10-03 from an empty Docker (no images, no volumes, no build cache): about
**eight minutes** to all seven containers healthy, on one command. The first build compiles MinIO
from source and is most of that. `api` starts only once Postgres,
Redis, MinIO and ClamAV are healthy **and** `migrate` has exited successfully, so it never serves
an un-migrated schema. ClamAV takes a couple of minutes to go healthy while it loads definitions.
Check progress with:

```bash
docker compose ps
```

**4. Seed the organisation and the first administrator** (once; re-running is harmless):

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml run --rm --no-deps migrate node dist/database/seed.js
```

With `NODE_ENV=production` the seed creates only the administrator and the Director you configured;
the development `records@` and `staff@` accounts below are not created. A server seeded before this
change may still have them: deactivate them, or change their passwords.

**5. Check the published ports, then put HTTPS in front.** Check with `docker compose -f docker-compose.yml -f docker-compose.production.yml config`, which must
show `ports:` only under `api` and `web`, each prefixed `127.0.0.1:`, and from another machine that
ports 5433, 6380, 9002, 9003, 3311, 3001 and 4001 on the server refuse connections. Then proxy the
public hostname to `web` (`WEB_HOST_PORT`, default 3001) and `/api` to `api` (`API_HOST_PORT`,
default 4001) from the same host.

**Upgrading:** pull, then run the step 3 command (with the overlay) again. `migrate` re-runs and `api`
waits for it. Back up first with `scripts/backup.sh`, and make sure `BACKUP_PATH` is on another
machine.

### Uploads stuck on "scan pending"

An attachment cannot be previewed or downloaded until ClamAV has passed it as `CLEAN`; anything
else **fails closed**. When every upload sits at "scan pending", one of these is the reason.

1. **The worker is not running.** `npm run dev` starts only the API and the web app; in local
   development, also run `npm run dev:worker -w @dts/api`. In Docker, `docker compose ps` should show
   `worker` as healthy.
2. **ClamAV is not healthy.** Run `docker compose ps clamav`. It should say `healthy` within a few
   minutes of starting. If it stays at `starting`, read the log:

   ```bash
   docker compose logs --tail 50 clamav
   ```

   `ERROR: Incorrect argument format for option TCPSocket` means `infra/clamav/clamd.conf` has
   Windows (CRLF) line endings: clamd reads the port as `3310
` and never starts. The
   `.gitattributes` keeps it LF on new checkouts. To repair an existing checkout:

   ```bash
   rm infra/clamav/clamd.conf
   git checkout -- infra/clamav/clamd.conf
   docker compose up -d --force-recreate clamav
   ```

3. **The uploads were made while the scanner was down.** A scan is retried 5 times over about
   30 seconds, then the job is parked as failed and the file stays pending even after ClamAV
   recovers. Once ClamAV is healthy, requeue the failed jobs:

   ```bash
   docker compose exec worker node -e "const {Queue}=require('bullmq');const q=new Queue('dts.outbox',{connection:{url:process.env.REDIS_URL}});q.retryJobs({state:'failed'}).then(()=>q.close())"
   ```

   Files that were already scanned are skipped, so this is safe to run more than once. When the
   worker runs outside Docker, run the same `node -e` from `apps/api` with `REDIS_URL` set to your
   `.env` value.

   If files stay pending after this, the jobs were lost with Redis. The full procedure, including
   that case, is in [`docs/runbooks/scanner-down.md`](docs/runbooks/scanner-down.md) and
   [`docs/runbooks/redis-loss.md`](docs/runbooks/redis-loss.md).

### Development accounts

`npm run db:seed` creates four users (`apps/api/src/database/seed.ts`):

| Role          | Email                | Password         | Placement                                      |
| ------------- | -------------------- | ---------------- | ---------------------------------------------- |
| Administrator | `admin@dts.local`    | `Admin@12345!`   | none; confidential access                      |
| Director      | `director@dts.local` | `Director@1234!` | Office of the Regional Director                |
| Records Staff | `records@dts.local`  | `Records@1234!`  | Office of the Regional Director / Records Unit |
| Staff Member  | `staff@dts.local`    | `Staff@12345!`   | Pilot Division / General Section               |

The Records Unit is a **Section inside the ORD**, not a division of its own (decision 152,
migration `0009`). That is what makes a draft the records officer registers an ORD draft, which
goes straight to `FOR_SIGNATURE` rather than collecting the Director's own initial first
(ADR-0007). An existing `RECORDS` division is deactivated rather than deleted, because its code is
embedded in reference numbers already issued on paper (decision 153).

Override the administrator password with `SEED_ADMIN_PASSWORD`. With `NODE_ENV=production` the
seed refuses to run without it, rather than plant the password printed above.

**The Director is deployment configuration, not seed data** (ADR-0006). Set `DIRECTOR_EMAIL` and
`DIRECTOR_PASSWORD` and the seed creates that account instead; with `NODE_ENV=production` both the
API and the seed refuse to run without them, because release is gated on a signature record and
nobody else may make one. `director@dts.local` above is a local convenience that production cannot
reach by forgetting to configure anything. There is no seeded viewer account;
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

### Integration tests

They run against **real** infrastructure — Postgres, Redis, MinIO and clamd — so the stack has to
be up, and they are destructive: every suite drops and recreates `public`, which is why
`ALLOW_DATABASE_RESET` exists. Point them at a database of their own, never at the one the running
app uses:

```bash
docker compose up -d --build postgres redis minio clamav
docker compose exec postgres createdb -U dts dts_test
```

```bash
DATABASE_URL=postgresql://dts:dts@localhost:5433/dts_test ALLOW_DATABASE_RESET=true npm run test:integration -w @dts/api
```

The MinIO credentials come from your `.env` — compose reads the same file, so the suites and the
running MinIO cannot disagree. Stop the `worker` container first (`docker compose stop worker`):
it consumes the same Redis queue, so it would race the scan test for the job and then look for the
version in the wrong database. CI does all of this in the `integration` job.

## Architecture note

`docs/architecture.md` is the orientation document: the layers, the stack choices, and why each
one looks the way it does. The decisions behind the load-bearing ones live in `docs/adr/`.

The backend is feature-complete through phase 6 and persisted to Postgres — the old in-process
`Map`-backed adapter has been retired, and attachments, scanning, realtime and the outbox relay all
run against real infrastructure. The frontend is partially built and mid-rebuild on shadcn/ui
(`docs/audits/frontend-rebuild-plan.md`). See `docs/IMPLEMENTATION_STATUS.md` for the exact boundary; the
repository does not claim pilot readiness.

The web UI has a per-browser selector for shadcn/ui or Material 3 Expressive on the sign-in,
request-account, and authenticated screens. It is independent of the light/dark control and does
not change document data or permissions.
