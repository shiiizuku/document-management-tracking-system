# Sourced by the backup scripts, not run.
#
# Docker Compose reads BACKUP_PATH from `.env` to mount the archive, but does not export it into
# the shell that runs these scripts, and the scheduled jobs do not set it. Without this the scripts
# fall back to ./backups and write their markers somewhere the archive (and the NAS push) never sees.
# An exported BACKUP_PATH still wins.
if [ -z "${BACKUP_PATH:-}" ]; then
  env_file="$(dirname "${BASH_SOURCE[0]}")/../.env"
  if [ -f "$env_file" ]; then
    value="$(grep -E '^BACKUP_PATH=' "$env_file" | tail -1 | cut -d= -f2- | tr -d '\r')"
    value="${value%\"}"; value="${value#\"}"; value="${value%\'}"; value="${value#\'}"
    [ -n "$value" ] && export BACKUP_PATH="$value"
  fi
  unset env_file value
fi
