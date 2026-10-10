# Monitoring and Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `monitor` compose service that probes every dependency, debounces failures, and sends one alert, reminders and one "resolved" message to a single sink.

**Architecture:** New npm workspace `apps/monitor` (Node 22, TypeScript, ESM, vitest). Pure modules (config, alert tracker, sinks) are separated from I/O probes; a scheduler runs all probes each cycle, feeds results to the tracker, and an HTTP server exposes `/health`, `/status`, `/metrics`. It probes over the compose network only and never touches the Docker socket.

**Tech Stack:** `pg`, `ioredis`, `bullmq` (all already used by `apps/api`), `vitest`, plain `node:http`.

**Spec:** `docs/superpowers/specs/2026-10-10-monitoring-alerts-design.md`

## Global Constraints

- Probe every `MONITOR_INTERVAL_SECONDS` (default 30); each probe times out after `PROBE_TIMEOUT_MS` (default 5000).
- A `crit` must fail `FAILURE_STRIKES` (default 2) consecutive cycles before it fires.
- Reminder every `ALERT_REMINDER_MINUTES` (default 60) while firing; one "resolved" message with outage duration on recovery.
- Sinks: `webhook` posts `{"text": "..."}` to `ALERT_WEBHOOK_URL`; `log` is always on. No SMTP.
- A failed send is logged and retried next cycle; the monitor never crashes on a sink error.
- No Docker socket. No published host port for the monitor. Restart `unless-stopped` in the production overlay.
- The monitor connects to Postgres as the read-only role `dts_monitor`, never the application credentials.
- Every new env var gets a compose entry. Files mounted into containers are pinned to LF.
- Backup thresholds reuse `check-backup-freshness.sh` defaults: `OBJECTS_MAX_AGE` 420, `BASE_MAX_AGE` 93600, `PUSH_MAX_AGE` 300 (seconds).
- Do not run repo-wide prettier; check only your own files with `npx prettier --end-of-line auto --check <files>`.

## Review Focus

1. Webhook URL set but the endpoint returns 500 or hangs: the alert is retried next cycle and the loop keeps running (Task 3).
2. State file missing, empty or corrupt at start: the monitor starts clean and does not crash (Task 2).
3. A probe throws or hangs past the timeout: recorded as `crit` with the reason, never an unhandled rejection (Task 6).
4. A check flapping ok/crit every cycle never reaches two consecutive failures, so it never alerts (Task 2).
5. A backup marker dated in the future (clock skew) yields age 0, not a negative age that passes forever or a crash (Task 5).

---

## File Structure

```
apps/monitor/
  package.json, tsconfig.json, vitest.config.ts, vitest.integration.config.ts, Dockerfile
  src/config.ts              env → MonitorConfig
  src/types.ts               CheckResult, Probe, Level
  src/alert-tracker.ts       debounce + firing/reminder/resolve state machine + JSON persistence
  src/sink.ts                AlertSink, WebhookSink, LogSink, createSink
  src/probes/http.ts         API, worker, MinIO probes
  src/probes/tcp.ts          Redis PING, ClamAV PING
  src/probes/postgres.ts     select 1, WAL archiver, stuck scans
  src/probes/queue.ts        BullMQ failed / oldest-waiting
  src/probes/backups.ts      marker-age checks
  src/runner.ts              runCycle: run probes with timeout, feed tracker, send alerts
  src/server.ts              /health /status /metrics
  src/main.ts                wiring, interval loop, heartbeat
  test/*.test.ts, test/*.int.test.ts
apps/api/drizzle/0017_monitor_role.sql    read-only role
apps/api/src/database/migrate.ts          set the role's login password
docs/runbooks/monitoring.md, docs/evidence/e3-monitoring-drill.md
```

---

### Task 1: Workspace scaffold and config

**Files:**
- Create: `apps/monitor/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/types.ts`, `src/config.ts`
- Test: `apps/monitor/test/config.test.ts`

**Interfaces:**
- Produces: `type Level = 'ok' | 'warn' | 'crit'`; `interface CheckResult { id: string; level: Level; detail: string }`; `interface Probe { id: string; run(signal: AbortSignal): Promise<CheckResult> }`.
- Produces: `interface MonitorConfig` (camelCase fields for every var in the table below) and `loadConfig(env: NodeJS.ProcessEnv): MonitorConfig`, which throws `Error` naming the variable on a non-numeric or non-positive value.

| Env var | Default | Env var | Default |
| --- | --- | --- | --- |
| `MONITOR_INTERVAL_SECONDS` | 30 | `FAILURE_STRIKES` | 2 |
| `PROBE_TIMEOUT_MS` | 5000 | `ALERT_REMINDER_MINUTES` | 60 |
| `QUEUE_WAIT_MAX_MINUTES` | 10 | `SCAN_PENDING_MAX_MINUTES` | 15 |
| `OBJECTS_MAX_AGE` / `BASE_MAX_AGE` / `PUSH_MAX_AGE` | 420 / 93600 / 300 | `MONITOR_PORT` | 4002 |
| `ALERT_WEBHOOK_URL` | unset | `MONITOR_STATE_FILE` | `/state/alerts.json` |
| `API_URL`, `WORKER_URL`, `MINIO_URL` | compose service URLs | `DATABASE_URL`, `REDIS_URL` | required |
| `CLAMAV_HOST`, `CLAMAV_PORT` | `clamav`, 3310 | `BACKUP_ARCHIVE_PATH`, `BACKUP_NAS_PATH` | `/archive`, unset (NAS check skipped) |

- [ ] **Step 1: Write failing tests in `test/config.test.ts`:** `applies defaults`, `reads overrides`, `rejects a non-numeric interval naming MONITOR_INTERVAL_SECONDS`, `rejects zero FAILURE_STRIKES`, `requires DATABASE_URL and REDIS_URL`.
- [ ] **Step 2: Run** `npm test -w @dts/monitor`. Expected: FAIL (module missing).
- [ ] **Step 3: Create the workspace** (`@dts/monitor`, `"type": "module"`, scripts `build`, `start`, `typecheck`, `test`, `test:integration` mirroring `apps/api/package.json`; extend `tsconfig.base.json` with NodeNext) and implement `loadConfig` and the types.
- [ ] **Step 4: Run** `npm install && npm test -w @dts/monitor && npm run typecheck -w @dts/monitor`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(monitor): scaffold the monitor workspace and its configuration`.

---

### Task 2: Alert tracker

**Files:**
- Create: `apps/monitor/src/alert-tracker.ts`
- Test: `apps/monitor/test/alert-tracker.test.ts`

**Interfaces:**
- Consumes: `CheckResult`, `MonitorConfig` (`failureStrikes`, `alertReminderMinutes`).
- Produces: `type AlertEvent = { kind: 'fired' | 'reminder' | 'resolved'; id: string; detail: string; since: number; durationMs?: number }`.
- Produces: `class AlertTracker { constructor(opts: { strikes: number; reminderMs: number; stateFile?: string }); observe(result: CheckResult, now: number): AlertEvent[]; snapshot(): Record<string, { level: Level; firing: boolean; since: number | null; detail: string }>; save(): Promise<void>; static load(opts): Promise<AlertTracker> }`.

- [ ] **Step 1: Write failing tests:** `does not fire on a single crit`; `fires once after the configured strikes`; `does not fire again while still failing`; `sends a reminder after the reminder interval`; `sends one resolved event with the outage duration`; `a warn never fires`; `flapping ok/crit/ok/crit never fires` (Review Focus 4); `a restored tracker does not re-fire a known outage` (save, load, observe crit); `load starts clean from a missing, empty or corrupt state file` (Review Focus 2); `a firing check resolved while the monitor was down emits resolved on first ok after restart`.
- [ ] **Step 2: Run** `npm test -w @dts/monitor -- alert-tracker`. Expected: FAIL.
- [ ] **Step 3: Implement `AlertTracker`.** Strike counter per check id resets on any non-crit result. `load` catches read and JSON errors and returns an empty tracker. `save` writes the file atomically (temp file, then rename).
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(monitor): debounced alert state machine with persisted state`.

---

### Task 3: Sinks

**Files:**
- Create: `apps/monitor/src/sink.ts`
- Test: `apps/monitor/test/sink.test.ts`

**Interfaces:**
- Consumes: `AlertEvent`.
- Produces: `interface AlertSink { send(event: AlertEvent): Promise<void> }` (rejects on failure); `class WebhookSink implements AlertSink { constructor(url: string, fetchImpl?: typeof fetch, timeoutMs?: number) }`; `class LogSink implements AlertSink { constructor(log: (line: string) => void) }`; `createSink(config: MonitorConfig, log): AlertSink` returning a `CompositeSink` that always logs and also posts when `alertWebhookUrl` is set; `formatEvent(event: AlertEvent): string`.

- [ ] **Step 1: Write failing tests:** `formatEvent states the check, kind and detail`; `resolved message includes the outage duration`; `WebhookSink posts {"text": ...} as JSON`; `WebhookSink rejects on a 500`; `WebhookSink rejects when the request exceeds its timeout` (fake fetch that never resolves; Review Focus 1); `createSink without a URL only logs`; `the composite still logs when the webhook rejects, then rethrows`.
- [ ] **Step 2: Run** `npm test -w @dts/monitor -- sink`. Expected: FAIL.
- [ ] **Step 3: Implement sinks** using `AbortSignal.timeout` for the webhook timeout.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(monitor): webhook and log alert sinks`.

---

### Task 4: Network probes

**Files:**
- Create: `apps/monitor/src/probes/http.ts`, `apps/monitor/src/probes/tcp.ts`
- Test: `apps/monitor/test/probes-network.test.ts`

**Interfaces:**
- Consumes: `Probe`, `CheckResult`.
- Produces: `httpProbe(id: string, url: string, opts?: { expectJsonStatus?: string }): Probe` (crit on non-2xx, connection failure, or a body whose `status` differs from `expectJsonStatus`); `redisPingProbe(redisUrl: string): Probe` (id `redis`); `clamavPingProbe(host: string, port: number): Probe` (id `clamav`; sends `PING\n`, expects `PONG`).
- Check ids used by the runner: `api`, `worker`, `minio`, `redis`, `clamav`.

- [ ] **Step 1: Write failing tests** against local `node:http` and `node:net` servers started in the test: `httpProbe is ok on 200`; `httpProbe is crit on 503 and includes the status in detail`; `httpProbe is crit when nothing listens`; `httpProbe honours the abort signal`; `clamavPingProbe is ok on PONG`; `clamavPingProbe is crit on a closed port`; `redisPingProbe is crit on an unreachable port` (no live Redis needed).
- [ ] **Step 2: Run** `npm test -w @dts/monitor -- probes-network`. Expected: FAIL.
- [ ] **Step 3: Implement.** Probes catch every error and return `crit` with `error.message` as detail; they never throw. Redis uses `ioredis` with `maxRetriesPerRequest: 1, lazyConnect: true`, disconnecting in `finally`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(monitor): http, redis and clamav probes`.

---

### Task 5: Data probes (Postgres, queue, backups)

**Files:**
- Create: `apps/monitor/src/probes/postgres.ts`, `queue.ts`, `backups.ts`
- Test: `apps/monitor/test/probes-backups.test.ts`, `probes-data.test.ts` (fakes)

**Interfaces:**
- Consumes: `Probe`, `MonitorConfig`.
- Produces: `postgresProbes(pool: Pick<Pool, 'query'>, cfg): Probe[]` returning ids `postgres` (`select 1`), `wal-archiver` (crit when `last_failed_time > coalesce(last_archived_time, '-infinity')` in `pg_stat_archiver`), `scan-pending` (crit when any `file_versions` row has `scan_status = 'PENDING'` and `uploaded_at` older than `scanPendingMaxMinutes`; detail gives the count and oldest age).
- Produces: `queueProbes(queue: Pick<Queue, 'getJobCounts' | 'getWaiting'>, cfg): Probe[]` returning ids `queue-failed` (crit when failed > 0) and `queue-stalled` (crit when the oldest waiting job's `timestamp` is older than `queueWaitMaxMinutes`).
- Produces: `backupProbes(cfg): Probe[]` returning ids `backup-objects`, `backup-base`, and, only when `backupNasPath` is set, `backup-push` (`$NAS/.status/pushed`). Marker paths: `$ARCHIVE/.status/objects`, `$ARCHIVE/.status/base`. Missing marker: crit "no marker at <path>". Age `max(0, now - mtime)`.

- [ ] **Step 1: Write failing tests:** backups using a temp directory with `utimes`: `ok for a fresh marker`; `crit for a stale marker naming the age and limit`; `crit when the marker is missing`; `a marker dated in the future counts as age 0` (Review Focus 5); `push probe absent when no NAS path`. Postgres and queue with fake `query` / queue objects: `postgres crit when the query rejects`; `wal-archiver crit when the failure row says t`; `scan-pending ok at zero rows, crit with count and age`; `queue-failed crit at 1 failed`; `queue-stalled crit past the wait limit, ok on an empty queue`.
- [ ] **Step 2: Run** `npm test -w @dts/monitor -- probes-`. Expected: FAIL.
- [ ] **Step 3: Implement.** SQL is plain parameterized strings; the queue's oldest-waiting job is the one with the smallest `timestamp` among `getWaiting(0, 49)`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(monitor): postgres, queue and backup-marker probes`.

---

### Task 6: Runner, server and entrypoint

**Files:**
- Create: `apps/monitor/src/runner.ts`, `server.ts`, `main.ts`
- Test: `apps/monitor/test/runner.test.ts`, `server.test.ts`

**Interfaces:**
- Consumes: `Probe`, `AlertTracker`, `AlertSink`, `MonitorConfig`.
- Produces: `runCycle(deps: { probes: Probe[]; tracker: AlertTracker; sink: AlertSink; timeoutMs: number; now: () => number; pending: AlertEvent[] }): Promise<CheckResult[]>`. Every probe runs concurrently under an `AbortSignal.timeout`; a throw or timeout becomes `{ level: 'crit', detail: 'probe failed: <message>' }` (Review Focus 3). Events from the tracker are appended to `pending`; each is sent, and any that fail stay in `pending` for the next cycle. Persists the tracker after each cycle.
- Produces: `startServer(opts: { port: number; host?: string; getStatus: () => StatusDocument; getHeartbeat: () => number; staleAfterMs: number }): Promise<Server>`. `GET /health` is 200 while the heartbeat is fresher than `staleAfterMs`, else 503. `GET /status` returns `{ generatedAt, checks: { [id]: { level, firing, since, detail } } }`. `GET /metrics` returns text with `dts_monitor_check_up{check="<id>"} 0|1`, `dts_monitor_check_firing{check="<id>"}` and `dts_monitor_last_cycle_timestamp_seconds`.
- `main.ts` builds pools and probes from `loadConfig(process.env)`, loads the tracker, sets the heartbeat after every cycle, schedules cycles with `setTimeout` (never overlapping), and shuts down cleanly on SIGTERM.

- [ ] **Step 1: Write failing tests:** `a throwing probe becomes crit with the reason`; `a probe that outlives the timeout becomes crit`; `one slow probe does not delay the others`; `failed sends stay pending and are resent next cycle, once each`; `a recovered check sends resolved exactly once`; `/health is 503 when the heartbeat is stale`; `/status lists every check`; `/metrics renders up and firing gauges`.
- [ ] **Step 2: Run** `npm test -w @dts/monitor -- runner server`. Expected: FAIL.
- [ ] **Step 3: Implement `runCycle`, `startServer` and `main.ts`.**
- [ ] **Step 4: Run** `npm test -w @dts/monitor && npm run typecheck -w @dts/monitor`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(monitor): probe runner, status endpoints and entrypoint`.

---

### Task 7: Read-only database role

**Files:**
- Create: `apps/api/drizzle/0017_monitor_role.sql`
- Modify: `apps/api/drizzle/meta/_journal.json` (add the entry exactly as 0016's, idx 17), `apps/api/src/database/migrate.ts`
- Test: `apps/api/test/monitor-role.int.test.ts`

**Interfaces:**
- Produces: role `dts_monitor` (`NOLOGIN` from the migration), granted `CONNECT` on the database and `SELECT` on `file_versions` only. `pg_stat_archiver` needs no grant. `migrate.ts` exports nothing new; after `migrate()`, when `MONITOR_DB_PASSWORD` is set it runs `ALTER ROLE dts_monitor LOGIN PASSWORD <value>` through a `DO` block using `format('%L', …)` so the password is never interpolated into SQL text.

- [ ] **Step 1: Write the failing integration test:** `dts_monitor can select from file_versions`; `dts_monitor cannot select from users`; `dts_monitor cannot insert into file_versions`; `migration is idempotent on a populated database` (run the migration SQL twice).
- [ ] **Step 2: Run** `npm run test:integration -w @dts/api -- monitor-role`. Expected: FAIL.
- [ ] **Step 3: Write the migration** (`DO` block, create-if-absent; header comment states reversal: `DROP ROLE dts_monitor` after revoking) and the `migrate.ts` post-step.
- [ ] **Step 4: Run** the same command plus `npm run test:integration -w @dts/api -- migration`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): read-only role for the monitor`.

---

### Task 8: Container, compose, CI and env

**Files:**
- Create: `apps/monitor/Dockerfile` (build and prune stages as `apps/api/Dockerfile`; runtime `USER node`, no npm)
- Modify: `docker-compose.yml`, `docker-compose.production.yml`, `.github/workflows/ci.yml`, `.env.example`, root `package.json` (`build` includes `@dts/monitor`)

**Interfaces:**
- Compose service `monitor`: `build` from the new Dockerfile; env for every variable in Task 1's table, with `DATABASE_URL` using `dts_monitor` and `MONITOR_DB_PASSWORD`; `migrate` receives `MONITOR_DB_PASSWORD` too; volumes `monitor_state:/state` and `${BACKUP_PATH:-./backups}:/archive:ro`, plus `${BACKUP_NAS_HOST_PATH:-./backups}:/nas:ro` only when documented; no `ports`; `depends_on` `postgres` and `redis` healthy; healthcheck `wget -qO- http://127.0.0.1:4002/health`; `restart: unless-stopped` in the production overlay.
- CI: add the monitor's unit tests to the existing quality job's `npm test`, and its integration suite to the `integration` job.

- [ ] **Step 1: Write the Dockerfile and compose entries**, with a comment on each new variable as the existing entries have.
- [ ] **Step 2: Verify** `docker compose -f docker-compose.yml -f docker-compose.production.yml config` parses and shows the monitor with no published port and `unless-stopped`.
- [ ] **Step 3: Verify** `docker compose build monitor` and `docker compose up -d monitor`; `docker compose exec monitor wget -qO- http://127.0.0.1:4002/status` lists every check, with `ok` for the running services.
- [ ] **Step 4: Verify** the new files are LF (`git ls-files --eol apps/monitor`) and add a `.gitattributes` line if the repo's existing rules do not already cover them.
- [ ] **Step 5: Commit** `feat(deploy): run the monitor in compose and CI`.

---

### Task 9: Integration tests against live services

**Files:**
- Create: `apps/monitor/vitest.integration.config.ts`, `apps/monitor/test/probes.int.test.ts`

**Interfaces:**
- Consumes: the real probes from Tasks 4 and 5 against the CI compose stack (`DATABASE_URL`, `REDIS_URL`, MinIO and ClamAV env as the `integration` job sets them).

- [ ] **Step 1: Write the tests:** every probe is `ok` against the live stack; `wal-archiver` is `ok` after a forced `pg_switch_wal()`; `scan-pending` is `crit` after inserting a `PENDING` version with an old `uploaded_at` (and cleaned up); `queue-failed` is `crit` after adding a job that fails permanently and `ok` after it is removed; `redis` and `clamav` probes are `crit` when pointed at a closed port.
- [ ] **Step 2: Run** `npm run test:integration -w @dts/monitor`. Expected: PASS against `docker compose up -d`.
- [ ] **Step 3: Commit** `test(monitor): probes against live services`.

---

### Task 10: Runbook, documentation and drill

**Files:**
- Create: `docs/runbooks/monitoring.md`, `docs/evidence/e3-monitoring-drill.md`
- Modify: `docs/runbooks/scanner-down.md` (replace the "no alert fires" note), `docs/runbooks/redis-loss.md`, `docs/risk-register.md` (R-11, R-13, R-14 "Revisit when" notes), `docs/on-premises-setup-guide.md`, `docs/IMPLEMENTATION_STATUS.md`

**Interfaces:**
- `monitoring.md` has one section per check id (`api`, `worker`, `postgres`, `wal-archiver`, `redis`, `minio`, `clamav`, `scan-pending`, `queue-failed`, `queue-stalled`, `backup-objects`, `backup-base`, `backup-push`): what it means, the first step, and the runbook to follow. It also covers setting `ALERT_WEBHOOK_URL`, reading `/status`, and silencing a known-planned outage.

- [ ] **Step 1: Write the runbook and update the four existing documents.**
- [ ] **Step 2: Run the staged-failure drill** on a separate compose project (`-p dts-e3`, ports offset as in `e1-failure-drills.md`) with a local webhook receiver: stop API, worker, Postgres, Redis, MinIO and ClamAV in turn, and age a backup marker. Record for each: the time of the failure, the time the alert arrived, the alert text, the resolve time. Expected: one alert and one resolve per failure.
- [ ] **Step 3: Tune** the defaults in Task 1's table if the drill shows a threshold too tight or too loose, and note any change in the evidence file.
- [ ] **Step 4: Run the full gate:** `npm run quality` with prettier limited to the files this branch touched. Expected: PASS.
- [ ] **Step 5: Commit, push and open the PR** from `ops/backup-restore-monitoring`, linking #32 without closing it (the second-machine restore is still owed). Enable PR auto-fix.
