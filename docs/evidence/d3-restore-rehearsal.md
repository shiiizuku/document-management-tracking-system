# D3: backup and restore rehearsal (local dry run)

_2026-10-04. Phase 7 sequencing, Wave D, box D3._

**Verdict: partial.** The procedure in [`runbooks/backup-restore.md`](../runbooks/backup-restore.md)
works as written. A host loss was rehearsed against pilot-sized data, and the stack was serving
traffic again **6 min 55 s** after the decision to restore, well inside P-13's 2–4 hour window. The
database came back to **37 s before the failure**, inside P-13's 5-minute recovery point.

Three things keep the box open:

1. **It ran on one machine.** The "lost" host and the "new" one were two compose projects on the
   same desktop, reading one archive folder on the same disk. The box asks for a restore from
   different storage. That still needs a second machine or a NAS.
2. **Attachments do not meet the recovery point.** The object store is mirrored only when
   `scripts/backup.sh` runs, which is nightly. Every file uploaded since then is lost with the host,
   while its database row comes back through WAL. This needs a decision (below).
3. **A fresh deployment archived no WAL until the first backup.** Found here and fixed (below).

## How it was run

Two throwaway compose projects with their own volumes and ports, so the development stack was not
touched: `dts-d3-src` (the host that is lost) and `dts-d3-dst` (its replacement). Both mounted one
`BACKUP_PATH` folder, standing in for the NAS.

1. **Source:** Postgres and MinIO up. D1's pilot seed (60,048 documents, 446 MB database), then
   `scripts/backup.sh`: a base backup in 20 s, 462 MB.
2. **Work after the backup:** two short D2 load runs against the source (10 actions/s, ~2.5 min
   each), so the restore has to replay WAL and some uploads exist only in the live store.
3. **Host loss:** `docker kill` on Postgres and MinIO, a crash rather than a clean shutdown, so any
   WAL not yet archived is lost the way it would be in a real failure. Then the source's volumes
   were deleted. Its committed state at the moment of the kill was read first, as ground truth.
4. **Replacement:** fresh Postgres and MinIO, then the runbook's steps in order: `restore.sh`
   (no target time, so it replays the whole archive), `restore-objects.sh`, `docker compose up -d`.

## Timeline

From the decision to restore (10:33:58 UTC) to the API reporting ready and a user signed in
(10:40:53 UTC):

| Step | Time |
| --- | ---: |
| Fresh Postgres and MinIO on the replacement | 13 s |
| `scripts/restore.sh`: copy the base, write the recovery config | 19 s |
| WAL replay to promotion (7 segments, timeline 1 → 2) | 3 s |
| `scripts/restore-objects.sh` | 2 s |
| `docker compose up -d --build --wait`: images built, migrate, API, worker, web, ClamAV | 350 s |
| **Total** | **6 min 55 s** |

Most of the time is building images and ClamAV's first start, not restoring. On the pilot host the
images would normally be pulled or already built, which shortens it. A real restore adds what this
one could not time: noticing the failure, getting a replacement host, and mounting the NAS on it.
Those are what decide whether the 2–4 hours holds, and they need the real hardware.

The base was minutes old here. A nightly base means up to a day of WAL to replay. On this machine
7 segments replayed in about 1 s, so even a busy day's worth should take minutes, but that is an
extrapolation, not a measurement.

## What came back

| | At the kill | Restored | Lost |
| --- | ---: | ---: | ---: |
| documents | 60,058 | 60,048 | 10 |
| file versions | 51,449 | 51,422 | 27 |
| workflow events | 285,174 | 285,150 | 24 |
| audit events | 598,745 | 598,654 | 91 |

The last restored transaction was at 10:32:17 UTC, which is the last WAL segment archived before
the kill at 10:33:10. The last write on the source was at 10:32:54, so **37 s of work was lost**.
That is the shape `archive_timeout=60` promises: at most about a minute, plus whatever the archive
copy takes.

**Checklist, against the restored stack:**

- [x] `GET /health/ready` reports database and storage up.
- [x] The Records account signs in (`201`).
- [x] The registry (`200`, 111 ms) and the dashboard (`200`, 494 ms) answer.
- [x] The newest restored document opens with its routes.
- [x] Every restored count is the source's count minus only rows written after the last archived
      segment.
- [x] A file version whose bytes were not restored fails closed: `404 Attachment content not found`,
      never wrong content (D-79).
- [ ] **A restored object downloads.** Not shown. The pilot seed writes file metadata without bytes,
      so the only objects in this run were uploads made after the mirror was taken, and none of them
      came back. The next rehearsal should run `backup.sh` after some uploads.
- [ ] **Restored from different storage.** Not shown; see the verdict.

## Findings

### 1. WAL archiving was off on a fresh deployment until the first backup (fixed)

`archive_command` copied into `/archive/wal/`, and only `scripts/backup.sh` created that directory.
On a fresh archive, every segment failed to archive (58 failures in the first minutes here) until
someone ran a backup. Postgres keeps failed segments in `pg_wal` and retries, so nothing was lost,
but nothing was protected either, and `pg_wal` grows meanwhile.

Fixed in `docker-compose.yml`: the command now runs `mkdir -p /archive/wal` first. Checked on a
fresh Postgres with an empty archive and no backup run: 2 segments archived, 0 failures.

### 2. Attachments are recovered to the last nightly backup, not to the last minute (open)

WAL covers the database continuously. The object store is mirrored only by `backup.sh`. When the
host is lost, every upload since the last mirror is gone, while its `file_versions` row comes back
through WAL. Here that was **146 versions with no bytes, 144 of them marked clean**. They fail
closed, so nobody receives the wrong file, but the documents now point at attachments that no
longer exist. For a records system that is the content people care about most.

P-13 says the recovery point is 5 minutes. For attachments it is currently up to 24 hours. Options,
cheapest first:

- **Run the object mirror far more often**, e.g. every 5 minutes from cron. `cp -au` only copies
  what is new, and stored versions are never rewritten, so each pass is cheap. The recovery point
  becomes the interval. This is the smallest change.
- **MinIO site or bucket replication** to a second MinIO on the NAS host. Continuous, but it is a
  second server to run, on an AGPL build compiled from source.
- **Accept the gap and record it in P-13**, with the failure mode written down: rows survive and
  their bytes may not.

This is a decision for the P-13 owner, not something to change in a rehearsal.

### 3. The load harness could not write its report to an absolute path (fixed)

`new URL('C:/…', base)` reads the drive letter as a URL scheme, so `LOAD_OUTPUT` and
`EXPLAIN_OUTPUT` with an absolute Windows path failed at the very end of a run, when the report was
written. Both now go through `reportUrl` in `apps/api/perf/database.ts`.

## Rerunning

The shape, with paths and ports to taste. Each project gets its own ports so it can run beside the
development stack:

```bash
# Source, with POSTGRES_DB=dts_perf so the perf seed has a database to target
COMPOSE_PROJECT_NAME=dts-d3-src BACKUP_PATH=<archive> POSTGRES_DB=dts_perf POSTGRES_HOST_PORT=5443 \
  MINIO_HOST_PORT=9012 MINIO_CONSOLE_HOST_PORT=9013 docker compose up -d --wait postgres minio
PERF_DATABASE_URL=postgresql://dts:dts@localhost:5443/dts_perf ALLOW_DATABASE_RESET=true \
  npm run perf:seed -w @dts/api
scripts/backup.sh                       # with the same COMPOSE_PROJECT_NAME and BACKUP_PATH
# ...work, then docker kill the source's containers and `docker compose down -v` it

# Replacement: a second project name, the same BACKUP_PATH, then the runbook
echo RESTORE | scripts/restore.sh
echo RESTORE | scripts/restore-objects.sh
docker compose up -d --build --wait
```

`COMPOSE_PROJECT_NAME` overrides the file's `name: dts`. **Check it with `docker compose config`
before running `restore.sh`**, which empties the target's Postgres volume.
