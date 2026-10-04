/**
 * Where the suite expects to find the system under test, and what it hands the servers it starts.
 *
 * One module so the Playwright config and the fixtures cannot disagree about a port.
 *
 * **The ports are the ordinary development ones** (`.env.example`: API 4001, worker health 4002,
 * web 3001) rather than a private set. The web client's API base is compiled into its bundle
 * (`NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:4001/api/v1` in
 * `apps/web/src/lib/api.ts`), so a private port would need a web build made specially for the
 * suite — and then the artefact under test would not be the artefact that ships. The cost is that
 * `npm run dev` must not be running: `reuseExistingServer` is off, so a developer's server is
 * never silently adopted, and the suite fails with a port-in-use error instead of running against
 * their database.
 */

export const WEB_PORT = 3001;
export const API_PORT = 4001;
export const WORKER_HEALTH_PORT = 4002;

export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const API_BASE_URL = `http://localhost:${API_PORT}/api/v1`;

/** The dedicated end-to-end database. See `database.ts` for why it is not the development one. */
export const DEFAULT_DATABASE_URL = 'postgresql://dts:dts@localhost:5433/dts_e2e';

/**
 * The Redis database index the suite's queue lives in.
 *
 * Not isolation for its own sake. `dts.outbox` is one BullMQ queue name, so a containerised
 * `worker` left running from `docker compose up` would compete for the same jobs — and that worker
 * reads a *different* Postgres database, so every job it won would fail to find the attachment
 * version and the scan would never complete. Half the runs, at random. A separate index makes the
 * two queues genuinely different keys.
 *
 * Only the index is the suite's choice: the host and port still come from `REDIS_URL`, so this is
 * not the kind of harness default that shadows a real setting. (Pub/sub is not database-scoped in
 * Redis, so the realtime channel is still shared — which is harmless, because a realtime message
 * is only ever a hint to refetch.)
 */
const E2E_REDIS_DATABASE = 1;

const redisUrl = (): string => {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  url.pathname = `/${E2E_REDIS_DATABASE}`;
  return url.toString();
};

/**
 * What the API and worker processes are started with.
 *
 * Deliberately short. Everything absent here — `SESSION_SECRET`, the `MINIO_*` and `CLAMAV_*`
 * variables — is inherited: from `.env` on a developer's machine (which `docker compose` reads too,
 * so the stack and the suite cannot disagree about a credential) and from the job environment in
 * CI. `apps/api/test/setup-int-env.ts` carries the same note, and for a reason paid for once
 * already: defaulting `MINIO_*` in a harness **shadows** the credentials the running MinIO was
 * actually started with, and surfaces as an authentication failure mid-suite rather than as the
 * configuration mistake it is.
 *
 * `NODE_ENV` is `test`, not `production`: production would demand `COOKIE_SECURE=true` (no HTTPS
 * here) and a configured Director, and the suite seeds its own.
 */
export const serverEnvironment = (): Record<string, string> => ({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  REDIS_URL: redisUrl(),
  PORT: String(API_PORT),
  WORKER_HEALTH_PORT: String(WORKER_HEALTH_PORT),
  WEB_ORIGIN: BASE_URL,
});
