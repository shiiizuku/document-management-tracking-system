#!/usr/bin/env bash
#
# Restores the object store from the mirror taken by scripts/backup.sh.
#
# Separate from the database restore on purpose, and run after it. A file version row pointing at
# an object that is not back yet is a fail-closed download (D-79); an object with no row is
# invisible and harmless. Recovering in the other order inverts that, and makes the window where
# the system is wrong the window where it looks fine.
#
# Policy register P-13. Runbook: docs/runbooks/backup-restore.md
set -euo pipefail

# See scripts/backup.sh: MSYS rewrites POSIX-looking arguments on Windows workstations.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

ARCHIVE_ROOT="${BACKUP_PATH:-./backups}"
test -d "$ARCHIVE_ROOT/objects" || { echo "no object mirror at $ARCHIVE_ROOT/objects" >&2; exit 1; }

printf '%s\n' "About to replace the object store from $ARCHIVE_ROOT/objects."
printf '%s\n' 'The API and worker stop while it runs.'
read -r -p 'Type RESTORE to continue: ' confirm
[ "$confirm" = 'RESTORE' ] || { echo 'Aborted.'; exit 1; }

docker compose stop api worker >/dev/null
# Replaced wholesale rather than merged: a mix of restored and surviving objects is the state
# nobody can reason about afterwards.
docker compose exec -T minio sh -c 'rm -rf /data/* && cp -a /archive/objects/. /data/'
docker compose restart minio >/dev/null

printf '%s\n' 'Object store restored. Bring the stack back up with: docker compose up -d'
