# Runbook: scanner down

Policy register **P-07**: the scanner **fails closed**. A file version that is not `CLEAN` is never
previewed or downloaded. Risk register **R-13**.

Everything below was observed on 2026-10-07, when ClamAV was stopped under a live stack
([`evidence/e1-failure-drills.md`](../evidence/e1-failure-drills.md)).

## How it shows up

**Every health check stays green.** ClamAV is not on any readiness path. While it was down, the
API's `/ready` and the worker's `/ready` both answered `ready`, and `docker compose ps` listed
every other container as `healthy`. Only `clamav` drops out of the list. Nothing alerts.

What people notice:

- Uploads still succeed (`201`), so nobody is told at upload time.
- The new file sits at **scan pending** in the document's attachments.
- Preview and download refuse it with `409 FILE_NOT_CLEAN`, "Attachment is unavailable until it
  passes malware scanning". That is the posture working as designed, not a fault.

What the worker log shows, once per attempt per file:

```text
"context":"OutboxConsumer:<job id>","message":{"name":"Error","message":"getaddrinfo ENOTFOUND clamav"
```

`ENOTFOUND` / `EAI_AGAIN` means the container is gone. A clamd that is running but hung reports
`clamd did not respond within …ms` instead.

## What the system does on its own

1. Each scan job is tried **5 times** with exponential backoff. In the drill, the five attempts
   for two files ran from 0:08 to 0:44 after ClamAV stopped. That's about 36 seconds.
2. Then BullMQ **parks the job as `failed`** and keeps it for inspection.
3. **The file stays `PENDING`.** It does not become `SCAN_FAILED`. Nothing in the code writes
   that status, despite what P-07's row says.
4. **When ClamAV comes back, nothing retries.** In the drill, ClamAV was healthy again 18 s after
   `docker start`. Its signatures persist in `clamav_data`. Twenty seconds after that, both files
   were still `PENDING`, with 2 jobs in `failed`. They stay that way until someone runs the
   requeue below.

## Recovering

**1. Find out why ClamAV is down.**

```bash
docker compose ps clamav
docker compose logs --tail 50 clamav
```

Two causes are already known:
- **CRLF in `infra/clamav/clamd.conf`:** the log shows `Incorrect argument format for option
  TCPSocket`. The fix is in the README under _Uploads stuck on "scan pending"_.
- **Memory:** ClamAV needs about 2 GB for its signatures. On a host short of memory it is the
  first container the kernel kills (`docker inspect clamav` → `OOMKilled: true`).

**2. Start it and wait for `healthy`.**

```bash
docker compose up -d clamav
docker compose ps clamav        # repeat until (healthy); 18 s with a warm volume
```

A cold volume downloads the signatures first, which takes a couple of minutes.

**3. Requeue the parked scans.**

```bash
docker compose exec worker node -e "const {Queue}=require('bullmq');const q=new Queue('dts.outbox',{connection:{url:process.env.REDIS_URL}});q.retryJobs({state:'failed'}).then(()=>q.close())"
```

In the drill this returned in 0.6 s, and both files were `CLEAN` within a second. Running it a
second time did nothing: a version that is already scanned is skipped, and no extra
`attachment.scanned` audit event was written. It is safe to repeat.

To requeue one file instead, call `POST /api/v1/documents/<documentId>/attachments/<versionId>/rescan` as a
records officer or administrator. It enqueues a fresh scan of a still-pending version and does nothing to a
version that already has a result; there is no way to mark a file clean by hand.

The command above requeues **every** failed outbox job, not only scans. Every other event type only pushes a
live notification, so a late duplicate costs nothing.

**4. Check that nothing is still pending.**

```bash
docker compose exec postgres psql -U dts -d dts -c "select scan_status, count(*) from file_versions group by 1"
```

A `PENDING` count that doesn't drain within a minute means the jobs no longer exist. That
happens when **Redis was also lost or recreated** while they were parked. The requeue has nothing
to retry then. Follow [`redis-loss.md`](redis-loss.md), _Stranded scans_.

Use `-U`/`-d` with your `POSTGRES_USER` and `POSTGRES_DB` if you changed them.

## Telling people

Files uploaded during the outage become available on their own after step 3. Nobody needs to
upload anything again. Until then the answer to "I can't open my attachment" is "it hasn't been
scanned yet".

## Not covered

- **An infected file** is a different event. It is scanned and stored `INFECTED`, and it is never
  servable. That is not an outage. Treat it as a security event:
  [`incident-response.md`](incident-response.md).
- **Monitoring.** No alert fires when ClamAV stops. Until monitoring exists (deferred to the
  contingency, R-03), `docker compose ps` and the pending count above are the only signals.
