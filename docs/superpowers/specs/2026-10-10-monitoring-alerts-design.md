# Monitoring and alerts: design

_2026-10-10. Issue #32 (monitoring half). Branch `ops/backup-restore-monitoring`._

## Purpose

Operators of the single office server must learn within minutes when the API, worker, Postgres,
Redis, MinIO, ClamAV, the job queues or the backups fail. Today nothing does: container
healthchecks exist, but no alert fires when ClamAV stops (`runbooks/scanner-down.md`), when parked
scans pile up (R-13, R-14), or when the attachment mirror stalls except through the backup script's
optional webhook (R-11).

**Success:** a staged failure of each dependency produces exactly one alert to a named person and one
"resolved" message on recovery, and the runbook says what to do first.

**Constraints (stated by the user or inherited):** self-hosted and LAN-only; one host (R-10); one
alert sink, webhook now with SMTP addable later; no Docker socket in any network-facing container;
every new env var gets a compose entry; mounted config files are pinned to LF.

**Out of scope:** SMTP delivery, Grafana dashboards, a Docker-socket container-state check, the
second-machine restore (the other half of #32).

## Approach

A new `apps/monitor` service (Node, same stack as the worker), run as a `monitor` compose service
with `restart: unless-stopped` in the production overlay. It probes over the compose network every
30 s with a 5 s timeout per probe. Chosen over Prometheus + Alertmanager + Grafana (five to seven
more containers to patch) and over extending the shell freshness script (fragile state tracking and
testing, especially on Windows).

## Checks

| Target   | Probe                                                                                                                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API      | `GET /api/v1/health/ready` (database + storage) and `/health`                                                                                             |
| Worker   | the worker's readiness endpoint                                                                                                                           |
| Postgres | `select 1`; `pg_stat_archiver` shows WAL archiving not failing since its last success                                                                     |
| Redis    | `PING`                                                                                                                                                    |
| MinIO    | its health endpoint                                                                                                                                       |
| ClamAV   | `PING` on port 3310                                                                                                                                       |
| Queues   | BullMQ `dts.outbox`: failed count above 0; oldest waiting job older than `QUEUE_WAIT_MAX_MINUTES`. `file_versions` stuck `PENDING` longer than `SCAN_PENDING_MAX_MINUTES` |
| Backups  | the freshness markers `scripts/check-backup-freshness.sh` reads (objects, base, push), mounted read-only, with the same thresholds                        |

Each check reports `ok`, `warn` or `crit`. A `crit` must fail two consecutive cycles before it
fires, so a single blip does not alert anyone.

## Alert state

Per check: `ok → firing → ok`.

- Entering `firing` sends one alert.
- While `firing`, a reminder goes out every `ALERT_REMINDER_MINUTES` (default 60).
- Returning to `ok` sends one "resolved" message with the outage duration.
- State is held in memory and mirrored to a JSON file on a volume, so a monitor restart neither
  re-announces a known outage nor forgets one.

## Sink

One `AlertSink` interface.

- `webhook`: POSTs `{"text": "..."}` to `ALERT_WEBHOOK_URL`, the payload shape the backup script
  already uses.
- `log`: structured log line. Always on; the fallback when no webhook is set.
- `smtp`: not built. The interface leaves room for it.

A failed send is logged and retried on the next cycle. The monitor never crashes on a sink error.

## Watching the watcher

The monitor writes a heartbeat timestamp each cycle. Its own container healthcheck fails when the
heartbeat goes stale, and `/status` is reachable so an external uptime tool or the backup check can
poll it.

## Endpoints and configuration

- `GET /status`: JSON with each check's state, last change and detail.
- `GET /metrics`: Prometheus text format, so a scraper can be added later without rework.
- Both are internal to the compose network; no host port is published.
- Every threshold is an env var with a default and a compose entry (interval, timeout, strike
  count, queue and scan-pending ages, backup ages, reminder interval, `ALERT_WEBHOOK_URL`).
- The monitor gets read-only access to Postgres and Redis, not the application's credentials. A
  dedicated read-only database role is created by a migration.

## Testing

- **Unit:** the state machine (two-strike debounce, fire once, reminder, resolve, restart from the
  JSON file), threshold evaluation, sink fallback and retry. Probes are faked.
- **Integration** (CI `integration` job, real Postgres, Redis and MinIO from compose): every probe
  returns `ok` against live services and `crit` after its target is stopped. This is the automated
  form of the E1 drills.
- **Staged-failure drill**, recorded in `docs/evidence/e3-monitoring-drill.md`: stop each of API,
  worker, Postgres, Redis, MinIO and ClamAV in turn, and let a backup marker go stale. Confirm one
  alert per failure, one resolve, and the failure-to-alert time.

## Documentation

- New `docs/runbooks/monitoring.md`: what each alert means, the first step, and how to set
  `ALERT_WEBHOOK_URL`.
- Update `runbooks/scanner-down.md` and `runbooks/redis-loss.md` (their "no alert fires" notes),
  risk-register rows R-11, R-13 and R-14, and `on-premises-setup-guide.md`.

## Rollout

One PR from `ops/backup-restore-monitoring`, built in a worktree. The monitor is added to the base
compose file and the production overlay (restart policy, no published port). The PR links #32 and
does not close it, because the second-machine restore is still owed.

## Open items

- The alert recipient and webhook endpoint are the office's to name; the design works with the log
  sink until they do.
- The queue and scan-pending thresholds are starting values, to be tuned from the drill.
