# Runbook: backup and restore

Policy register **P-13** — recovery point **≤ 5 minutes**, restore window **2–4 hours**.

Two halves, and both are needed. Postgres archives its write-ahead log continuously; a scheduled
job takes a base backup and mirrors the object store. A base backup alone recovers only to the
moment it was taken. The WAL alone recovers nothing — it has to be replayed onto a base.

## Where the archive goes

`BACKUP_PATH` is bind-mounted into `postgres` and `minio` as `/archive`:

```
$BACKUP_PATH/
  wal/        every closed WAL segment, written by Postgres itself
  base/       one directory per base backup, named for the instant it was taken
  objects/    a mirror of the object store
```

**The archive must end up on a different machine.** The failure this scheme exists for is the
loss of the application host, and an archive on that host is lost with it. A 60-second archive
interval buys nothing if the copy dies with the original. Decided 2026-10-06: it goes to the
office NAS, an SMB share. [`nas-backup-target.md`](nas-backup-target.md) sets that up. On a Linux
host `BACKUP_PATH` is the mounted share. On a Windows host Docker cannot write to a share, so
`BACKUP_PATH` is a local folder and `scripts/push-archive.ps1` copies it to the NAS every minute.

## Scheduling

| Job | Cadence | Why |
| --- | --- | --- |
| WAL archiving | continuous, segment closed every 60s | Postgres does this itself; it is what bounds data loss to minutes |
| `scripts/mirror-objects.sh` | every 3 minutes | Bounds what attachments lose to the same few minutes as the rows that point at them. 5 minutes plus the push to the NAS can exceed P-13 |
| `scripts/backup.sh` | nightly | Bounds replay time on restore; runs a mirror pass too |
| `scripts/push-archive.ps1` | every minute, Windows hosts only | Copies the local archive to the NAS |

How each is scheduled on the pilot host (Task Scheduler on Windows, cron on Linux) is in
[`nas-backup-target.md`](nas-backup-target.md).

A nightly base keeps replay under an hour for a pilot-sized database. Taking it less often does
not lose data, but it lengthens the restore and so eats into the 4-hour window.

Prune `base/` and the WAL older than the oldest base you intend to keep. Deleting WAL newer than
that breaks every restore that would have replayed through it.

## Restoring

Order matters: **database first, then objects.** A file version row whose object is not back yet
is a refused download, which is fail-closed and safe (D-79). An object with no row is invisible.
Restoring objects first inverts that — the window where the system is wrong is the window where
it looks fine.

**Restore from a copy of the NAS archive, never from the NAS archive itself.** Copy it down
first (`robocopy \\<nas>\<share>\dts D:\dts-restore /E`, or `rsync -a` on Linux) and point
`BACKUP_PATH` at the copy. Once promoted, the restored Postgres starts archiving its new timeline
into `BACKUP_PATH`, and that must not land in the archive being read. Details:
[`nas-backup-target.md`](nas-backup-target.md), Restoring onto a replacement server.

```bash
scripts/restore.sh                                            # latest base, all available WAL
scripts/restore.sh 20261002T120000Z                           # a specific base
scripts/restore.sh 20261002T120000Z '2026-10-02 13:45:00+00'  # ... stop at an instant
docker compose logs -f postgres                               # watch the replay finish
scripts/restore-objects.sh
docker compose up -d
```

Both scripts require typing `RESTORE` to proceed, and both replace their target wholesale rather
than merging into it — a mix of restored and surviving state is what nobody can reason about
afterwards.

Point-in-time recovery is what makes a bad write survivable, not just a dead disk: stop the replay
just before the mistake.

## What is not covered, deliberately

- **Redis** holds BullMQ queues. The outbox lives in Postgres, so the relay republishes anything
  unconfirmed — losing Redis costs in-flight jobs, not records. It is not in the recovery point.
- **ClamAV's volume** is virus signatures. They re-download on start.
- **Deletions are not propagated to the object mirror.** `cp -au` adds and updates, never removes,
  so an object deleted from the store stays in the mirror. For an append-only record system that
  is the safe direction, and it means the mirror is not a defensible source for "what exists now"
  — only for "what the bytes were".

## Rehearsing

The restore window is a claim until it has been timed. Rehearse against a copy of production
volume sizes, record the wall-clock time from decision to accepting traffic, and compare it with
the 2–4 hours in P-13.

**Rehearsed from the NAS (2026-10-06, [`evidence/d3-restore-rehearsal.md`](../evidence/d3-restore-rehearsal.md)).**
Pilot-sized data under load, the host killed rather than stopped, its disks deleted, and a fresh
compose project restored from the NAS alone. Serving again **7 min 33 s** after the decision to
restore, 2 min 39 s of it copying the archive down from the NAS. The database came back to **47 s**
before the failure and the attachments to **3 min 1 s**, both inside P-13's 5 minutes. The first
dry run (2026-10-04) used one disk for everything; its findings are in the same file.

**Attachments recover to the last mirror pass**, not to the minute. Uploads after the last pass
come back as rows whose downloads fail closed (`404 Attachment content not found`, D-79). With the
mirror every 3 minutes that is at most a few minutes of uploads. Tell the people who made them
to upload those files again.

## Developing on Windows

`pg_basebackup` will report success and leave the archive empty if the scripts are run from Git
Bash without `MSYS_NO_PATHCONV=1`. MSYS rewrites arguments that look like absolute POSIX paths
into Windows ones before the process sees them, so `-D /archive/base/...` arrives as
`C:/Program Files/Git/archive/base/...`; the backup is written there, faithfully, and the mount
stays empty.

All three scripts export that variable at the top, so running them normally is safe. It bites
only when a command is typed by hand. The Docker bind mount itself is fine on Windows — a base
backup lands on it exactly as it does on Linux.

WAL archiving is never affected: Postgres runs `archive_command` itself, inside the container,
with no shell of yours in the path.
