#!/usr/bin/env bash
#
# Base backup of Postgres plus a mirror of the object store.
#
# This is the periodic half of the recovery scheme; the continuous half is the WAL archiving
# Postgres does on its own (docker-compose.yml, `archive_command`). A base backup alone recovers
# only to the moment it was taken, and WAL alone recovers nothing — point-in-time restore needs
# the base to replay onto, which is why `pg_basebackup` is used here rather than `pg_dump`.
#
# Policy register P-13: recovery point <= 5 minutes, restore window 2-4 hours.
# Runbook: docs/runbooks/backup-restore.md
set -euo pipefail

# Git Bash/MSYS rewrites arguments that look like absolute POSIX paths into Windows ones before
# the process sees them, so `-D /archive/base/...` reaches pg_basebackup as `C:/Program
# Files/Git/archive/...`: it writes there, reports success, and the archive stays empty. Harmless
# on the Linux deployment host, silent and wrong on a Windows workstation.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

ARCHIVE_ROOT="${BACKUP_PATH:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$ARCHIVE_ROOT/wal" "$ARCHIVE_ROOT/base" "$ARCHIVE_ROOT/objects"

# -X none: the WAL this backup needs is already being archived continuously, so bundling a copy
# into the backup would store it twice and still not cover the gap after the backup ends.
docker compose exec -T postgres pg_basebackup \
  -U "${POSTGRES_USER:-dts}" -D /archive/base/"$STAMP" -Fp -X none -c fast

# The object store is mirrored at the filesystem level rather than through the S3 API.
#
# `mc` is not in this image: the stack builds MinIO from the AGPL source because the published
# images are license-gated, and that build ships the server alone. Copying the data directory
# needs no extra client, and it is the same shape as the base backup above — the restore replaces
# the volume rather than replaying writes into a running server.
#
# `-u` copies only what is newer, which converges cheaply because a stored file version is never
# rewritten (D-71/D-72). An upload in flight is either fully present or absent, since MinIO writes
# to a temporary name and renames, so a half-written object cannot appear under a real key.
# Deletions are not propagated — see the runbook.
docker compose exec -T minio sh -c 'mkdir -p /archive/objects && cp -au /data/. /archive/objects/'

printf '%s\n' "Base backup at $ARCHIVE_ROOT/base/$STAMP; objects mirrored to $ARCHIVE_ROOT/objects."
printf '%s\n' "WAL continues to archive to $ARCHIVE_ROOT/wal between runs."
