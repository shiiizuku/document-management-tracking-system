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

There are two ways to run it. **Option A works today** and needs no infrastructure; Option B is
the target once the persistence adapters are wired in (see `docs/IMPLEMENTATION_STATUS.md`).

### Option A — Run in your browser, no infrastructure (default)

The executable API currently uses an in-process, in-memory adapter, so the whole app runs without
Docker, PostgreSQL, or a `.env` file. State lives in memory and resets on restart.

```bash
npm install                     # first time only
npm run build -w @dts/contracts # build the shared Zod contracts (creates dist/)
npm run dev                     # starts the API (:4000) and web (:3000) together
```

Then open:

- Web app — `http://localhost:3000`
- API base — `http://localhost:4000/api/v1`
- OpenAPI UI — `http://localhost:4000/api/docs`

Sign in with any development account below.

### Option B — Full stack with infrastructure (target state)

Requirements: Node.js 22+, npm 11+, Docker Desktop.

```bash
cp .env.example .env
npm install
npm run build -w @dts/contracts
docker compose up -d postgres redis minio clamav
npm run db:migrate
npm run db:seed
npm run dev
```

Same URLs as Option A.

### Development accounts

| Role          | Email               | Password        |
| ------------- | ------------------- | --------------- |
| Administrator | `admin@dts.local`   | `Admin@1234!`   |
| Records Staff | `records@dts.local` | `Records@1234!` |
| Staff Member  | `staff@dts.local`   | `Staff@12345!`  |
| Viewer        | `viewer@dts.local`  | `Viewer@1234!`  |

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

The executable API currently uses the deterministic in-process application adapter so the full workflow slice can be run and tested without infrastructure. The production Drizzle schema and migration are included, but replacing that adapter with the PostgreSQL/MinIO/outbox adapters is still required before a real pilot. See `docs/IMPLEMENTATION_STATUS.md` for the exact boundary; the repository does not claim pilot readiness.
