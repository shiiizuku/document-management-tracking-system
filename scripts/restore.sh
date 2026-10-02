#!/usr/bin/env bash
#
# Point-in-time restore: a base backup, then the archived WAL replayed on top of it.
#
# The old script restored a `pg_dump` and recovered to whenever that dump was taken. This one
# replays the continuous archive, which is what makes a recovery point of minutes possible rather
# than a day. Everything it needs is under BACKUP_PATH; nothing is read from the live volume.
#
# Usage:
#   scripts/restore.sh                      # latest base, replay all available WAL
#   scripts/restore.sh 20261002T120000Z     # that base, replay all available WAL
#   scripts/restore.sh 20261002T120000Z '2026-10-02 13:45:00+00'   # ... and stop at that instant
#
# Policy register P-13. Runbook: docs/runbooks/backup-restore.md
set -euo pipefail

# See scripts/backup.sh: MSYS rewrites POSIX-looking arguments on Windows workstations.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

ARCHIVE_ROOT="${BACKUP_PATH:-./backups}"
BASE_STAMP="${1:-}"
TARGET_TIME="${2:-}"

if [ -z "$BASE_STAMP" ]; then
  BASE_STAMP="$(ls -1 "$ARCHIVE_ROOT/base" | sort | tail -n 1)"
  test -n "$BASE_STAMP" || { echo "no base backup under $ARCHIVE_ROOT/base" >&2; exit 1; }
fi
BASE_DIR="$ARCHIVE_ROOT/base/$BASE_STAMP"
test -d "$BASE_DIR" || { echo "no base backup at $BASE_DIR" >&2; exit 1; }

cat <<WARNING
About to restore into the running stack.

  base          $BASE_DIR
  WAL archive   $ARCHIVE_ROOT/wal
  stop at       ${TARGET_TIME:-the end of the archive}

This DESTROYS the current contents of the postgres volume. The object store is not touched;
restore it separately, and only after the database is accepted.
WARNING
read -r -p 'Type RESTORE to continue: ' confirm
[ "$confirm" = 'RESTORE' ] || { echo 'Aborted.'; exit 1; }

docker compose stop api worker web postgres

# The data directory is replaced wholesale. Postgres will not start on a half-replaced one, and a
# merge of old and new files is the condition that produces a database which starts and is wrong.
docker compose run --rm --entrypoint sh -T postgres -c '
  set -e
  rm -rf /var/lib/postgresql/data/*
  cp -a /archive/base/'"$BASE_STAMP"'/. /var/lib/postgresql/data/
  chmod 700 /var/lib/postgresql/data
'

# `restore_command` feeds the archived segments to recovery. `recovery.signal` is what tells
# Postgres this is a recovery rather than a crash restart; without it the archive is ignored and
# the cluster comes up at the base backup's own point, silently losing everything after it.
RECOVERY="restore_command = 'cp /archive/wal/%f %p'"
if [ -n "$TARGET_TIME" ]; then
  RECOVERY="$RECOVERY
recovery_target_time = '$TARGET_TIME'
recovery_target_action = 'promote'"
fi
docker compose run --rm --entrypoint sh -T postgres -c "
  set -e
  printf '%s\n' \"$RECOVERY\" >> /var/lib/postgresql/data/postgresql.auto.conf
  touch /var/lib/postgresql/data/recovery.signal
"

docker compose up -d postgres
printf '%s\n' 'Postgres is replaying the archive. Watch it finish with:'
printf '%s\n' '  docker compose logs -f postgres'
printf '%s\n' 'Then restore the object mirror and bring the rest up:'
printf '%s\n' "  scripts/restore-objects.sh"
printf '%s\n' '  docker compose up -d'
