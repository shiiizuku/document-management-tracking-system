# D3: backup and restore rehearsal

_Phase 7 sequencing, Wave D, box D3. Rehearsed from the NAS on 2026-10-06; a local dry run on
2026-10-04 is kept below._

**Verdict: done.** The application host was lost under load: killed, its volumes and its local
archive deleted. A fresh compose project, reading only what was on the NAS, was serving again
**7 min 33 s** after the decision to restore, against P-13's 2–4 hours. The database came back to
**47 s** before the failure, and the attachments to **3 min 1 s** before it, both inside P-13's
5 minutes. Every item on the runbook's checklist passed, including downloading a restored file
whose checksum matched.

What this does not show: the time to notice the failure, get a replacement server and install
Docker on it. Those need the real pilot hardware. They are the part of the 2–4 hours this could not
time, and the measured part leaves nearly all of the window for them.

## The NAS, and how the archive reached it

The share is `\\172.31.3.252\outgoing admin records`, mapped on this workstation as `X:`. The
rehearsal used `X:\prototype - dts\backup\rehearsal-2026-10-06`.

**Docker cannot write to it.** That was the first thing checked, and the answer shaped the rest:

- A bind mount of `X:\prototype - dts\backup` **appeared to work and did not.** Inside the
  container `/archive` was an empty ext4 folder in Docker Desktop's VM. A probe file written to it
  never appeared on the NAS. Postgres would have archived into it and `backup.sh` would have
  reported success, with nothing off the host.
- The UNC path is refused: `is not a valid Windows path`.
- A Docker volume with the `cifs` driver and guest access: `permission denied`. With an account it
  would work, but the password then sits in the volume's options, readable through
  `docker volume inspect`. Not done.

So the stack wrote its archive to a local folder (`BACKUP_PATH=C:/dts-d3/src-archive`), and a copy
job pushed it to the share every 60 s with `robocopy /E /XO`, never deleting. That is the route a
Windows pilot server needs too. It is now `scripts/push-archive.ps1`, which refuses to run unless
the share holds a `.dts-archive` marker; both cases were tested against the NAS. The pilot server
is expected to be Windows Server; setup for it, or for Linux, is in
[`runbooks/nas-backup-target.md`](../runbooks/nas-backup-target.md).

**Not exercised:** Postgres's `archive_command` writing to an SMB mount from inside a container,
which is the Linux route. This workstation cannot mount the share into Docker without storing the
password.

**The 2026-10-04 fix still holds.** On a fresh archive with no backup run, `wal/` appeared by
itself and the first segment archived (`archived_count 1, failed_count 0`). Here that was the
local folder, as above.

## How it was run

Two throwaway compose projects with their own ports and volumes; the development stack (`dts`) was
not touched.

1. **Source `dts-d3-src`:** Postgres, MinIO, Redis and ClamAV up, the NAS push started.
   `perf:seed` (60,000 documents, 51,276 file versions with metadata only), then
   `scripts/backup.sh` at 06:42:26 UTC: a 461 MB base backup in 22 s, on the NAS by 06:44:21.
2. **Work:** the D2 load harness, in production mode against the source, at 5 actions/s from
   06:43. It registers documents and uploads real 512 KiB files, which ClamAV scans. The object
   mirror ran every 5 minutes (`scripts/mirror-objects.sh`): passes at 06:43:02, 06:48:10,
   06:53:24 and 06:58:40, each 8–16 s.
3. **Host loss at 07:01:30 UTC**, scheduled in advance: within 2.8 s, the push and mirror jobs, the
   API, worker and load generator were killed, and the four containers were `docker kill`ed. The
   last push to the NAS had finished at 07:00:53, so nothing was in flight. The source's committed
   state was then read from its volumes as ground truth: a throwaway Postgres on the dead volume,
   archiving off. Then `docker compose down -v`, and the local archive folder was deleted. All
   that was left was the NAS.
4. **Replacement `dts-d3-dst`**, the runbook in order, timed from the decision at 07:02:18: copy
   the archive down from the NAS into a fresh folder, fresh Postgres and MinIO, `restore.sh` (no
   target time), `restore-objects.sh`, `docker compose up -d --build --wait`.

## Timeline

| Step | Time |
| --- | ---: |
| Copy the archive from the NAS (2,140 files, 1.57 GB, at 11 MB/s) | 2 min 39 s |
| Fresh Postgres and MinIO | 19 s |
| `scripts/restore.sh`: copy the base, write the recovery config | 17 s |
| WAL replay to promotion (19 segments, redo 4.4 s, timeline 1 → 2) | 7 s |
| `scripts/restore-objects.sh` | 8 s |
| `docker compose up -d --build --wait`: images, migrate, API, worker, web, ClamAV | 4 min 3 s |
| **Total, decision to `GET /health/ready` 200 (07:09:51)** | **7 min 33 s** |

The NAS copy is new compared with the dry run, and it grows with the archive. At pilot size,
with a nightly base, a day of WAL and a few GB of attachments, expect 5–15 minutes on this
network. The builds had a warm Docker cache from the development stack. A new server builds from
nothing, which the dry run measured at about 6 minutes.

## What came back

| | At the kill | Restored | Lost |
| --- | ---: | ---: | ---: |
| documents | 60,088 | 60,084 | 4 |
| file versions | 51,609 | 51,593 | 16 |
| workflow events | 285,348 | 285,331 | 17 |
| audit events (to the kill) | 598,952 | 598,896 | 56 |

| Recovery point | Last thing restored | Before the last write (07:01:31.0) |
| --- | --- | ---: |
| **Database** | last transaction at 07:00:43.6, the last WAL segment pushed | **47 s** |
| **Attachments** | newest upload with bytes at 06:58:30.1, the last mirror pass | **3 min 1 s** |

**Attachments**, counting the load's uploads only:

| | |
| ---: | --- |
| 333 | uploaded on the source, all scanned clean, 333 objects in its store |
| 317 | rows restored by WAL |
| 285 | of those came back with their bytes: every upload before the 06:58:40 mirror pass |
| 32 | came back as rows without bytes: uploaded between 06:58:46 and 07:00:42, after the last pass |
| 0 | objects restored without a row |

The 32 are what the mirror interval costs, and they fail closed (below). The boundary is exact:
the first upload missing its bytes is 6 s after the pass started.

**Checklist, against the restored stack:**

- [x] `GET /health/ready` reports database and storage up (`200`).
- [x] The Records account signs in (`201`).
- [x] The registry (`200`, 123 ms) and the dashboard (`200`, 543 ms) answer.
- [x] The newest restored document opens (`200`).
- [x] Every restored count is the source's count minus only rows written after the last pushed
      WAL segment.
- [x] **A restored object downloads**, as its uploader: `200`, 524,288 bytes, and its SHA-256
      matches the checksum recorded at upload. (Owed since the dry run.)
- [x] A file version whose bytes were not restored fails closed: `404 Attachment content not found`,
      never wrong content (D-79).
- [x] **Restored from different storage.** Only the NAS survived the host. (Owed since the dry
      run.)
- [x] The restored Postgres archived its new timeline to the replacement's own folder, not to the
      NAS archive it was restoring from.

## Findings

### 1. A mapped drive given to Docker Desktop silently stays on the host

Recorded above. It is the most dangerous failure found in D3, because every tool reports success.
`runbooks/nas-backup-target.md` warns about it. The push script's marker check stops the Windows
route from writing an "off-host" copy to the host, and the Linux cron entries check the same
marker.

### 2. A 5-minute mirror does not quite meet P-13 on a Windows host (schedule changed to 3)

Measured: 3 min 1 s. The worst case is the mirror interval, plus the pass, plus up to a minute for
the push: about 6 minutes at a 5-minute interval, over P-13's 5. The decision allowed 5–15
minutes "often enough to meet the database's recovery point". The runbooks now schedule the
mirror **every 3 minutes**, which puts the worst case near 4½ minutes. A pass of a store this size
took 8–16 s. A real pilot store with tens of thousands of objects takes longer to walk; watch the
first week's pass times in the task history.

### 3. Restore from a copy of the archive, not the archive

A restored Postgres starts archiving its new timeline into whatever `BACKUP_PATH` is. Here that was
the replacement's own folder, as the runbook now says to do. Pointed at the NAS archive itself, the
replacement would write into the history it was reading. `archive_command` refuses to overwrite,
and new-timeline names differ, so nothing would be destroyed, but the archive would be harder to
reason about in the next incident.

## Rerunning

As in the dry run below, with two changes. The source pushes its `BACKUP_PATH` to the NAS
(`scripts/push-archive.ps1` on a schedule, or the rehearsal's 60 s loop). The replacement's
`BACKUP_PATH` is a fresh folder filled from the NAS (`robocopy <share> <folder> /E`) **after** the
source's volumes and local archive are deleted. Check each project with `docker compose config`
before `restore.sh`.

## Local dry run (2026-10-04)

**Verdict at the time: partial.** Superseded by the NAS rehearsal above. The procedure in [`runbooks/backup-restore.md`](../runbooks/backup-restore.md)
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

### How it was run

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

### Timeline

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

### What came back

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

### Findings

#### 1. WAL archiving was off on a fresh deployment until the first backup (fixed)

`archive_command` copied into `/archive/wal/`, and only `scripts/backup.sh` created that directory.
On a fresh archive, every segment failed to archive (58 failures in the first minutes here) until
someone ran a backup. Postgres keeps failed segments in `pg_wal` and retries, so nothing was lost,
but nothing was protected either, and `pg_wal` grows meanwhile.

Fixed in `docker-compose.yml`: the command now runs `mkdir -p /archive/wal` first. Checked on a
fresh Postgres with an empty archive and no backup run: 2 segments archived, 0 failures.

#### 2. Attachments are recovered to the last nightly backup, not to the last minute (decided 2026-10-06; see above)

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

#### 3. The load harness could not write its report to an absolute path (fixed)

`new URL('C:/…', base)` reads the drive letter as a URL scheme, so `LOAD_OUTPUT` and
`EXPLAIN_OUTPUT` with an absolute Windows path failed at the very end of a run, when the report was
written. Both now go through `reportUrl` in `apps/api/perf/database.ts`.

### Rerunning

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
