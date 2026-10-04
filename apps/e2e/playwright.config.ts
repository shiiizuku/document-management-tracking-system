import { defineConfig, devices } from '@playwright/test';
import {
  API_PORT,
  BASE_URL,
  WEB_PORT,
  WORKER_HEALTH_PORT,
  serverEnvironment,
} from './fixtures/environment';

/**
 * The end-to-end harness (C2 of `docs/phase-7-sequencing.md`).
 *
 * It follows the pattern Wave B established for the integration job: the **infrastructure** comes
 * from `docker-compose.yml`, started in a step rather than declared as service containers, and the
 * **application** runs as plain Node processes on the runner. Two reasons not to put the API,
 * worker and web app in compose as well: their images would have to be built per run, minutes
 * each, and `webServer` already owns start-up, readiness and teardown — including showing a
 * server's own log when it fails to come up, which is where most first failures are.
 *
 * Start the infrastructure first; the suite does not start it for you:
 *
 *     docker compose up -d --wait --wait-timeout 420 postgres redis minio clamav
 *     npm run build
 *     npm run test:e2e -w @dts/e2e
 *
 * ClamAV and the worker are not optional. An outgoing document cannot be released until its
 * current attachment is clean *and* signed, and the verdict comes from real clamd through the
 * worker's outbox consumer — there is no way to assert a clean scan, which is the point of the
 * rule (a manual `CLEAN` override is refused; `scanner.int.test.ts` proves it).
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',

  /*
   * One worker, and nothing in parallel.
   *
   * There is a single API, a single worker and a single database behind every spec, so parallel
   * files would interleave writes into the same registry and each other's truncations. The suite
   * is small and the serial run is a few minutes; sharding it would mean a stack per shard.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,

  // Generous, because one journey waits on a real virus scan. `waitForScanClean` has its own
  // 90-second budget inside this.
  timeout: 180_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Kept only for a failure: a trace per passing journey is tens of megabytes of CI artefact
    // nobody opens.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [
    /*
     * Signs in once per principal and saves the session. `retries: 0` deliberately: a retry here
     * would make a sixth login inside the same minute and be refused by the throttle, turning a
     * legible failure into a 429 nobody can explain.
     */
    {
      name: 'auth',
      testMatch: /auth\.setup\.ts/,
      retries: 0,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['auth'],
    },
  ],

  /*
   * `reuseExistingServer` is off in every environment, including locally.
   *
   * The alternative is worse than a port clash: a developer's `npm run dev` on these ports is
   * pointed at their own database, so adopting it would run the suite against their data and fail
   * with assertion errors about missing fixtures. Off, the failure is "port 3001 is already used",
   * which says what to do. See `fixtures/environment.ts` for why the ports are the ordinary ones.
   *
   * **The gate is liveness, not readiness, and that is not laziness.** Playwright starts these
   * servers *before* `globalSetup` runs, and the global setup is what creates the end-to-end
   * database — so gating on `/health/ready`, which probes Postgres, deadlocks: the API waits for a
   * database that is waiting for the API to be ready. `/health` answers without touching a
   * dependency, which is exactly what it is for (see `health.controller.ts` on why the two are
   * separate). Both processes open connections lazily and per query, so neither needs restarting
   * once the schema exists.
   *
   * Readiness is then asserted where a failure can be explained: `smoke.spec.ts` checks both
   * processes' `/ready` as its first test.
   *
   * The commands are `node …` rather than `npm run start`, duplicating what those scripts do. On
   * Windows `npm` is a shim that spawns node as a grandchild, and Playwright's teardown kills the
   * shim — leaving a server holding port 3001, so the *next* run fails with "already used" and the
   * real failure is two runs back. Invoking node directly makes the process Playwright started the
   * process it stops. Keep these in step with `apps/api`'s `start` / `start:worker` and
   * `apps/web`'s `start` (by way of `start-web.mjs`).
   */
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: '../api',
      url: `http://localhost:${API_PORT}/api/v1/health`,
      env: serverEnvironment(),
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      command: 'node dist/worker.js',
      cwd: '../api',
      url: `http://localhost:${WORKER_HEALTH_PORT}/health`,
      env: serverEnvironment(),
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      // Through a launcher that first copies the static assets in, as the Dockerfile does — see
      // `start-web.mjs` for why that cannot wait for the global setup.
      command: 'node start-web.mjs',
      url: BASE_URL,
      // The API base is compiled into the bundle at build time, so there is nothing to configure
      // here beyond the port — see `fixtures/environment.ts`.
      env: { PORT: String(WEB_PORT) },
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    },
  ],
});
