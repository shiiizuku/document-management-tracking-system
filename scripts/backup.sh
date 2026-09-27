#!/usr/bin/env bash
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="${1:-backups/$STAMP}"
mkdir -p "$TARGET"
docker compose exec -T postgres pg_dump -U dts -d dts -Fc > "$TARGET/postgres.dump"
docker compose run --rm --entrypoint sh minio -c "mc alias set local http://minio:9000 dts-local change-this-local-secret >/dev/null && mc mirror --overwrite local/dts-files /backup" >/dev/null
printf '%s\n' "Backup created at $TARGET"
