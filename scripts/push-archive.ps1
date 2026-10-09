# Copies the local backup archive to the NAS. Run every minute by Task Scheduler on a Windows host.
#
# Docker on Windows cannot bind-mount an SMB share: a mapped drive comes back as an empty folder
# inside Docker's VM and a UNC path is refused. So Postgres and MinIO write the archive to a local
# folder (BACKUP_PATH), and this copies it off the host. The recovery point gains this job's
# interval: WAL closes a segment every 60 s, this pushes it within the next minute.
#
# Copy-only (`/E /XO`): nothing on the NAS is ever deleted or overwritten with something older, so a
# damaged or wiped host cannot take the archive with it. Prune the NAS separately (runbook).
#
# Policy register P-13. Runbooks: docs/runbooks/nas-backup-target.md, docs/runbooks/backup-restore.md
param(
  [Parameter(Mandatory)] [string] $Source,       # BACKUP_PATH, e.g. D:\dts-archive
  [Parameter(Mandatory)] [string] $Destination,  # the share, e.g. \\nas\dts-backup\dts
  [string] $Log = "$env:ProgramData\dts\push-archive.log"
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force (Split-Path $Log) | Out-Null

# The share is marked once at installation. Without the marker this is not the NAS (not mounted,
# wrong path, signed out), and copying there would put the "off-host" archive back on this host.
if (-not (Test-Path -LiteralPath (Join-Path $Destination '.dts-archive'))) {
  Add-Content $Log "$(Get-Date -Format o) SKIPPED: no .dts-archive marker at $Destination"
  exit 2
}

$started = Get-Date -Format o
robocopy $Source $Destination /E /XO /R:2 /W:5 /NP /NFL /NDL /NJH /NJS | Out-Null
$code = $LASTEXITCODE
# Robocopy exit codes 0-7 are success (bit flags for copied/extra/mismatched); 8 and up are failures.
Add-Content $Log "$started rc=$code"
if ($code -ge 8) { exit $code }

# Proof that the whole copy finished: written only after robocopy reported success, so a push that
# copied the markers and then failed on a later file leaves this one stale. Read by
# scripts/check-backup-freshness.sh.
$status = Join-Path $Destination '.status'
New-Item -ItemType Directory -Force $status | Out-Null
Set-Content -LiteralPath (Join-Path $status 'pushed') -Value $started
exit 0
