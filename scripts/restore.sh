#!/usr/bin/env bash
set -euo pipefail
SOURCE="${1:?usage: scripts/restore.sh backups/<timestamp>}"
test -f "$SOURCE/postgres.dump"
docker compose exec -T postgres dropdb -U dts --if-exists dts
docker compose exec -T postgres createdb -U dts dts
docker compose exec -T postgres pg_restore -U dts -d dts --clean --if-exists < "$SOURCE/postgres.dump"
printf '%s\n' "Database restored from $SOURCE. Restore the matching MinIO snapshot before accepting traffic."
