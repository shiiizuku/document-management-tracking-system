#!/usr/bin/env bash
#
# Reports whether the backup jobs are still producing fresh copies, and exits 1 when one is not.
#
# Nothing else notices a job that has stopped: a failed Task Scheduler run, a NAS that went away or
# a mirror that hangs leaves the last good copy in place and every log quiet, while the recovery
# point (policy P-13, 5 minutes) quietly grows. Run this every 5 minutes (docs/runbooks/nas-backup-target.md)
# and have the scheduler's failure, or the webhook below, reach a person.
#
# Usage: scripts/check-backup-freshness.sh [--nas DIR] [ARCHIVE_DIR]
#   ARCHIVE_DIR  the local archive; defaults to $BACKUP_PATH, then ./backups
#   --nas DIR    also check the off-host copy (e.g. //nas/dts-backup/dts, or its mount point)
#
# Checks, each reported as OK or STALE:
#   objects    .status/objects, touched by scripts/mirror-objects.sh after a good pass
#   base       .status/base, touched by scripts/backup.sh after a good base backup
#   archiver   Postgres has not been failing to archive WAL since its last success (needs docker)
#   nas        with --nas: a marker the push writes only after a whole successful copy, the same two
#              markers there, and the newest local WAL segment that has had
#              time to be pushed is on the NAS
#
# WAL is not judged by file age. Postgres closes a segment each minute only while there is
# database activity, so an idle night would look stale; the archiver check and the NAS comparison
# are independent of activity.
#
# Thresholds (seconds) can be overridden: OBJECTS_MAX_AGE (default 420: one missed 3-minute pass
# plus the minute-long push), BASE_MAX_AGE (default 93600: the 01:30 nightly plus two hours),
# PUSH_GRACE (default 180: how old a local WAL segment must be before it must be on the NAS),
# PUSH_MAX_AGE (default 300: the push runs every minute). All must be whole numbers.
# Set ALERT_WEBHOOK_URL to also POST {"text": "..."} there when anything is stale.
set -uo pipefail

export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

OBJECTS_MAX_AGE="${OBJECTS_MAX_AGE:-420}"
BASE_MAX_AGE="${BASE_MAX_AGE:-93600}"
PUSH_GRACE="${PUSH_GRACE:-180}"
PUSH_MAX_AGE="${PUSH_MAX_AGE:-300}"

for name in OBJECTS_MAX_AGE BASE_MAX_AGE PUSH_GRACE PUSH_MAX_AGE; do
  case "${!name}" in
    '' | *[!0-9]*) echo "$name must be a whole number of seconds, not '${!name}'" >&2; exit 2 ;;
  esac
done

NAS=""
# shellcheck source=scripts/backup-env.sh
. "$(dirname "$0")/backup-env.sh"
ARCHIVE="${BACKUP_PATH:-./backups}"
while [ $# -gt 0 ]; do
  case "$1" in
    --nas)
      [ $# -ge 2 ] || { echo "--nas needs a directory" >&2; exit 2; }
      NAS="$2"
      shift 2
      ;;
    *)
      ARCHIVE="$1"
      shift
      ;;
  esac
done

[ -d "$ARCHIVE" ] || { echo "No archive directory at $ARCHIVE" >&2; exit 2; }

NOW="$(date +%s)"
failures=()

report() { printf '%-9s %-5s %s\n' "$1" "$2" "$3"; }
stale() { failures+=("$1: $2"); report "$1" STALE "$2"; }

# Age in seconds of a marker file, or nothing when it does not exist.
age_of() { [ -f "$1" ] && echo $((NOW - $(stat -c %Y "$1"))); }

check_marker() { # check_marker LABEL FILE MAX_AGE
  local age
  age="$(age_of "$2")"
  if [ -z "$age" ]; then
    stale "$1" "no marker at $2 (the job has never completed here)"
  elif [ "$age" -gt "$3" ]; then
    stale "$1" "last good run ${age}s ago, limit ${3}s"
  else
    report "$1" OK "last good run ${age}s ago"
  fi
}

check_marker objects "$ARCHIVE/.status/objects" "$OBJECTS_MAX_AGE"
check_marker base "$ARCHIVE/.status/base" "$BASE_MAX_AGE"

# `t` when the most recent archive attempt failed after the most recent success. Without docker on
# this host there is nothing to ask and the check is skipped; with docker but no running postgres
# container, WAL production has stopped, which is exactly what this is here to catch.
if ! command -v docker >/dev/null 2>&1; then
  report archiver SKIP "docker is not available from here"
elif ! docker compose ps --status running --services 2>/dev/null | grep -qx postgres; then
  stale archiver "the postgres container is not running (or docker compose cannot reach this stack)"
else
  failing="$(docker compose exec -T postgres psql -U "${POSTGRES_USER:-dts}" -d "${POSTGRES_DB:-dts}" -Atc     "select coalesce(last_failed_time > coalesce(last_archived_time, '-infinity'), false) from pg_stat_archiver" 2>/dev/null | tr -d '[:space:]')"
  case "$failing" in
    f) report archiver OK "WAL archiving is succeeding" ;;
    t) stale archiver "Postgres is failing to archive WAL (pg_stat_archiver.last_failed_time is newer than last_archived_time)" ;;
    *) stale archiver "could not read pg_stat_archiver" ;;
  esac
fi

if [ -n "$NAS" ]; then
  if [ ! -f "$NAS/.dts-archive" ]; then
    stale nas "no .dts-archive marker at $NAS (share not mounted, or not the NAS)"
  else
    # The copied markers only show what the source held when they were copied. A push that copied
    # them and then failed on a later file would leave them fresh, so the push itself leaves a
    # marker, written only after the whole copy succeeded (push-archive.ps1). When the archive is
    # the NAS mount itself (Linux), there is no push to prove.
    if [ "$NAS" -ef "$ARCHIVE" ]; then
      report nas-push SKIP "the archive is the NAS mount; there is no separate push"
    else
      check_marker nas-push "$NAS/.status/pushed" "$PUSH_MAX_AGE"
    fi
    check_marker nas-obj "$NAS/.status/objects" "$OBJECTS_MAX_AGE"
    check_marker nas-base "$NAS/.status/base" "$BASE_MAX_AGE"
    # The newest local segment old enough to have been pushed must be there.
    newest="$(find "$ARCHIVE/wal" -maxdepth 1 -type f -mmin +$((PUSH_GRACE / 60)) -printf '%T@ %f\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-)"
    if [ -z "$newest" ]; then
      report nas-wal SKIP "no local WAL segment old enough to compare"
    elif [ -f "$NAS/wal/$newest" ]; then
      report nas-wal OK "newest pushable segment $newest is on the NAS"
    else
      stale nas-wal "segment $newest is in the local archive but not on the NAS (the push is not running or failing)"
    fi
  fi
fi

if [ "${#failures[@]}" -gt 0 ]; then
  if [ -n "${ALERT_WEBHOOK_URL:-}" ] && command -v curl >/dev/null 2>&1; then
    message="DTS backup freshness: $(printf '%s; ' "${failures[@]}")"
    payload="$(printf '{"text":"%s"}' "$(printf '%s' "$message" | sed 's/\\/\\\\/g; s/"/\\"/g')")"
    curl -fsS -m 10 -X POST -H 'Content-Type: application/json' -d "$payload" "$ALERT_WEBHOOK_URL" >/dev/null \
      || echo "Could not reach ALERT_WEBHOOK_URL" >&2
  fi
  exit 1
fi
