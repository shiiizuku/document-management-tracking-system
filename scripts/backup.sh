#!/usr/bin/env bash
#
# Base backup of Postgres plus a pass of the object mirror.
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

# shellcheck source=scripts/backup-env.sh
. "$(dirname "$0")/backup-env.sh"
ARCHIVE_ROOT="${BACKUP_PATH:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$ARCHIVE_ROOT/wal" "$ARCHIVE_ROOT/base" "$ARCHIVE_ROOT/objects"

# -X none: the WAL this backup needs is already being archived continuously, so bundling a copy
# into the backup would store it twice and still not cover the gap after the backup ends.
docker compose exec -T postgres pg_basebackup \
  -U "${POSTGRES_USER:-dts}" -D /archive/base/"$STAMP" -Fp -X none -c fast

# Marker for scripts/check-backup-freshness.sh; reached only if pg_basebackup succeeded (`set -e`).
touch "$ARCHIVE_ROOT/.status/base" 2>/dev/null || { mkdir -p "$ARCHIVE_ROOT/.status" && touch "$ARCHIVE_ROOT/.status/base"; }

# The object store is mirrored by its own script, which also runs every 3 minutes on its own so
# attachments meet the database's recovery point rather than this job's nightly one.
bash "$(dirname "$0")/mirror-objects.sh"

printf '%s\n' "Base backup at $ARCHIVE_ROOT/base/$STAMP; objects mirrored to $ARCHIVE_ROOT/objects."
printf '%s\n' "WAL continues to archive to $ARCHIVE_ROOT/wal between runs."
