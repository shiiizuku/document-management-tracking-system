#!/usr/bin/env bash
#
# Mirrors the object store into the archive. The attachment half of the recovery point.
#
# WAL bounds what the database loses to about a minute. Files are not in the WAL, so an upload
# is safe only once a pass of this script has copied it. Run it every 3 minutes (see
# docs/runbooks/nas-backup-target.md) and attachments meet P-13's 5 minutes: up to 3 minutes
# waiting for a pass, the pass itself, and on a Windows host up to a minute more for the push to
# the NAS. A 5-minute interval comes to about 6 in the worst case (D3, 2026-10-06).
# `scripts/backup.sh` runs it too, after the base backup.
#
# Policy register P-13. Runbook: docs/runbooks/backup-restore.md
set -euo pipefail

# See scripts/backup.sh: MSYS rewrites POSIX-looking arguments on Windows workstations.
export MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'

# Mirrored at the filesystem level rather than through the S3 API. `mc` is not in this image:
# the stack builds MinIO from the AGPL source because the published images are license-gated,
# and that build ships the server alone. Copying the data directory needs no extra client, and
# the restore replaces the volume rather than replaying writes into a running server.
#
# `-u` copies only what is newer, so a pass over an unchanged store is cheap: a stored file
# version is never rewritten (D-71/D-72). An upload in flight is either fully present or absent,
# since MinIO writes to a temporary name and renames, so a half-written object cannot appear under
# a real key. Deletions are not propagated; see the runbook.
docker compose exec -T minio sh -c 'mkdir -p /archive/objects && cp -au /data/. /archive/objects/'

printf '%s\n' "Objects mirrored to ${BACKUP_PATH:-./backups}/objects at $(date -u +%Y-%m-%dT%H:%M:%SZ)."
