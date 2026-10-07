# E1 failure drills (2026-10-07)

The observations behind the three E1 runbooks:
[`scanner-down.md`](../runbooks/scanner-down.md), [`redis-loss.md`](../runbooks/redis-loss.md) and
[`incident-response.md`](../runbooks/incident-response.md).

**Setup.** A separate compose project (`docker compose -p dts-e1`), built from `main` at `0689b86`,
with every host port moved up by 10,000 so it ran beside the developer's own `dts` stack without
touching it. Seeded with `node dist/database/seed.js`. Docker Desktop on Windows 11. The drill
client signed in as `records@dts.local`, registered an incoming document and uploaded small PDFs
through the real API. State was read from `file_versions.scan_status`, unpublished
`outbox_events`, and BullMQ's job counts for `dts.outbox`. Times are UTC.

Baseline: one upload, `CLEAN` within a second.

## 1. Scanner down

| Time | Action | Observed |
| --- | --- | --- |
| 01:27:26 | `docker stop` ClamAV | API `/ready` 200 (`database`, `storage` up). Worker `/ready` 200. Every other container `healthy` |
| 01:27:28 | 2 uploads | Both `201`. Both `PENDING`. Queue: 1 waiting, 1 active |
| 01:27:34–01:28:10 | — | Worker logs `getaddrinfo ENOTFOUND clamav` (sometimes `EAI_AGAIN`), 5 attempts per job with backoff |
| 01:28:15 | — | Queue: **2 failed**. Files **still `PENDING`**. No `SCAN_FAILED` |
| — | Download and preview of a pending version | `409 FILE_NOT_CLEAN`, "Attachment is unavailable until it passes malware scanning" |
| 01:28:38 | `docker start` ClamAV | `healthy` after **18 s** (warm signature volume) |
| 01:29:16 | — | Still 2 `PENDING`, 2 failed. **No automatic retry** |
| 01:29:25 | README requeue (`retryJobs({state:'failed'})`) | Returned in 0.6 s. Both `CLEAN` within 1 s |
| — | Requeue run again | No change. `attachment.scanned` audit count stayed at 3 |

**Finding: P-07's register row says retries end in `SCAN_FAILED`. They don't.** Nothing in the
code writes `SCAN_FAILED` (it exists only in the enum). The file stays `PENDING` and the job
parks. The posture is still fail-closed, which is what P-07 decided, but its "current
behaviour" column was wrong. It is corrected in this PR.

## 2. Redis

**Outage (data intact).**

| Time | Action | Observed |
| --- | --- | --- |
| 01:29:45 | `docker stop` Redis | API `/ready` 200. Worker `/ready` **503** (`redis: down`) |
| 01:29:47 | Register + 2 uploads | All `201`. 3 outbox rows unpublished. Files `PENDING` |
| — | — | API logs `RealtimeBridge … realtime subscriber error: getaddrinfo ENOTFOUND redis` every ~5 s |
| ~01:31:15 | — | Worker container still **`healthy`**, failing streak 7. Healthcheck is 12 retries × 10 s |
| 01:31:16 | `docker start` Redis | Outbox drained, `document.created` delivered, both scans `CLEAN` by 01:31:23 (**7 s**) |

**Data loss.**

| Time | Action | Observed |
| --- | --- | --- |
| 01:31:3x | ClamAV stopped, 2 uploads, retries exhausted | 2 `PENDING`, 2 failed jobs. Outbox rows published |
| 01:32:21 | `docker compose rm -sf redis`, `docker volume rm dts-e1_redis_data`, `up -d redis`, ClamAV started | Queue empty. Files **still `PENDING`** |
| — | README requeue | No change. Nothing to retry |
| 01:33:09 | `update outbox_events … set published_at = null` for `attachment.uploaded` rows of `PENDING` versions | `UPDATE 2`. Both `CLEAN` at 01:33:10 |

**Finding:** "the relay republishes anything unconfirmed" (`backup-restore.md`, R-14) is true
only for rows not yet published. Jobs that were already in Redis are lost with it. For scans that
strands the file at `PENDING`, and only the SQL above recovers it.

## 3. Incident controls

| Control | Observed |
| --- | --- |
| Deactivate a signed-in user | Their live session got `401 Account is inactive` 19 ms later. Fresh sign-in `401`. Audit: `user.deactivated`, `auth.login` FAILURE `ACCOUNT_INACTIVE` |
| Reactivate the same user | **The session refused a moment earlier answered `200` again** |
| Sign-in limit | 5 attempts a minute per address, successes included. The 2nd wrong password in a busy minute got `429` |
| Account lockout | 5 wrong passwords spaced 13 s apart: each `401`, then the correct password `401` with the same message. `failed_login_attempts = 5`, `locked_until` +15 min. Audit `ACCOUNT_LOCKED`. Admin list `"locked": true` |
| Unlock | Admin **Reactivate** on the still-active account: next sign-in `201` |
| Password change or reset | **No endpoint exists.** A reset from the API container (bcrypt, `strongPasswordSchema`) refused a weak password, and on a strong one the old password got `401` and the new one `201` |
| Forge a session with the compose default `SESSION_SECRET` | HS256 token for `admin@dts.local`, signed with `local-development-session-secret-change-before-pilot`: **`GET /me` 200** |
| Rotate `SESSION_SECRET` (`up -d api worker`) | API `healthy` in 9 s. A saved admin session: `401 Session is invalid or expired`. The forged token: `401` |

**Findings:**

- **The compose default `SESSION_SECRET` lets anyone who has read the repository sign in as
  anyone.** `validateEnvironment` checks only its length, so `NODE_ENV=production` accepts it too.
  Risk register R-09 and R-21.
- **There is no way to change or reset a password in the app**, and **reactivation brings old
  sessions back**. Risk register R-22.

## Not drilled

- A hung clamd (the timeout path) rather than a stopped one.
- An `INFECTED` upload. B1's EICAR test (`apps/api/test/scanner.int.test.ts`) covers it.
- Rotating `POSTGRES_PASSWORD` and the MinIO keys.
