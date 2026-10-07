# Runbook: Redis loss

Redis holds the BullMQ queue (`dts.outbox`) and carries live notifications between the worker and
the API. It holds **no records**. Documents, routes, file rows, audit events and the durable
notification inbox are all in Postgres. Risk register **R-14**.

Everything below was observed on 2026-10-07 in two drills on a live stack
([`evidence/e1-failure-drills.md`](../evidence/e1-failure-drills.md)):

- **Outage:** Redis stopped for 90 s, then started again on the same volume.
- **Data loss:** the Redis container and its volume deleted, with scans parked as failed, then a
  fresh Redis started.

## How it shows up

**The API stays up and keeps saying `ready`.** It doesn't probe Redis. Sign-in, registering
documents and uploads all worked during the outage (`201`). Sessions are stateless JWTs and
didn't notice.

What stops:

- **Background work.** New outbox events pile up in Postgres unpublished. In the drill there were 3
  (one `document.created` and two `attachment.uploaded`). New uploads sit at **scan pending**.
- **Live notifications.** The API logs this every few seconds:
  `RealtimeBridge … realtime subscriber error: getaddrinfo ENOTFOUND redis`. Notifications still
  land in each user's inbox, because that's written in the same transaction as the action, but
  nobody gets the live badge until they reload.

**The worker's container stays `healthy` for about 2 minutes.** Its `/ready` returned `503` at
once (`"redis":"down"`). But the compose healthcheck allows 12 failures 10 s apart. After 90 s
Docker still showed `healthy`, with a failing streak of 7. Check `/ready` directly instead of
trusting the status column:

```bash
docker compose exec worker wget -qO- http://127.0.0.1:4001/ready
```

## Outage: Redis stopped, data intact

Start it:

```bash
docker compose up -d redis
```

**Nothing else needs doing.** In the drill, the relay published the 3 waiting events about 7 s
after Redis started, the scans ran, and both files were `CLEAN`. The API's subscriber and the
worker reconnected on their own. Nothing needed a restart.

Redis persists to its volume with AOF, so a restart or a host reboot is this case.

## Data loss: volume deleted, corrupt, or a fresh Redis

Start a fresh Redis:

```bash
docker compose up -d redis
```

Events **not yet published** when Redis was lost are safe: the relay publishes them as usual.
**What's lost is every job that was already in Redis**: waiting, delayed, or parked as `failed`.

That matters only for scans. Any other event type only pushes a live notification, and its inbox
row is already in Postgres. A lost scan job, though, leaves its file at `PENDING` permanently:

- its outbox row is already marked published, so the relay never sends it again;
- the queue is empty, so the scanner-down requeue (`retryJobs({state:'failed'})`) has nothing to
  retry. In the drill it ran and changed nothing.

### Stranded scans

Check for them:

```bash
docker compose exec postgres psql -U dts -d dts -c "select scan_status, count(*) from file_versions group by 1"
```

If `PENDING` doesn't drain within a minute or two, mark those versions' upload events unpublished
again. The relay sends them on its next pass, within a second:

```bash
docker compose exec postgres psql -U dts -d dts -c "update outbox_events o set published_at = null from file_versions v where o.event_type = 'attachment.uploaded' and o.payload->>'versionId' = v.id::text and v.scan_status = 'PENDING' and o.published_at is not null"
```

In the drill this reported `UPDATE 2`, and both files were `CLEAN` 1 s later. It is safe to run
more than once. It touches only versions that are still `PENDING`. The scanner skips any version
that has already been scanned. The job id is the outbox row's id, so a job that is still queued
is not added twice.

**ClamAV must be healthy first.** Otherwise the re-sent jobs fail again and park, which takes you
back to [`scanner-down.md`](scanner-down.md).

## Not covered

- **Live notifications missed during the outage** aren't replayed. Users see them in the inbox,
  which is written to Postgres, not Redis.
- **Backups.** Redis is not backed up, on purpose. See [`backup-restore.md`](backup-restore.md).
  After a host restore, Redis starts empty. Run the stranded-scans check above after every
  restore.
