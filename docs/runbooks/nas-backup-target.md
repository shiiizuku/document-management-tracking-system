# Runbook: the NAS as the backup target

Policy register **P-13**: recovery point **≤ 5 minutes**, restore window **2–4 hours**, backups
kept **off the application host**. Decided 2026-10-06: the off-host storage is the office NAS,
reached as an SMB share. The NAS stores files and nothing else. It cannot run Docker, so a restore
always happens on a server, reading from the share. [`backup-restore.md`](backup-restore.md)
covers the backup scheme and the restore itself.

This page sets up the **pilot server** so that the archive ends up on the NAS. Do it once when the
server is installed, and again on a replacement server before restoring onto it.

The pilot server is expected to be **Windows Server** (not yet confirmed). How the archive reaches
the NAS depends on that, so both are written down:

- **Windows host** (section 3a). Docker cannot write to the share directly, so the stack writes the
  archive to a local folder and a scheduled task copies it to the NAS every minute. This is what
  the D3 rehearsal ran ([`evidence/d3-restore-rehearsal.md`](../evidence/d3-restore-rehearsal.md)).
- **Linux host**, including a Linux VM under Hyper-V on the Windows server (section 3b). The share
  is mounted and Docker writes to it directly.

## 1. What goes where

```
NAS  \\<nas>\<share>\dts\
  .dts-archive  an empty marker file: "this folder is the real NAS archive"
  wal/          every closed WAL segment, about one a minute while busy
  base/         one directory per nightly base backup (scripts/backup.sh)
  objects/      the object-store mirror, refreshed every 3 minutes (scripts/mirror-objects.sh)
```

## 2. On the NAS

1. Create the folder, e.g. `dts` inside an existing share or a share of its own, and put an empty
   file named `.dts-archive` in it. The scheduled jobs refuse to run where the marker is missing.
2. Create a **dedicated NAS account**, e.g. `dts-backup`, with read/write on that folder and nothing
   else. Do not reuse a person's account: the server keeps its password, and the account should open
   nothing but the archive.
3. Give people **read-only** access to the folder at most. Anyone who can delete files in `wal/`
   can break every restore that would replay through them.
4. Allow SMB 3. SMB 1 is not needed and should stay off.
5. Size it: one nightly base (about 0.5 GB at pilot size), WAL (16 MB per segment, up to one a
   minute while busy, so a few GB a day), and the attachments. Keep the bases you intend to restore
   from and the WAL after the oldest of them (pruning: `backup-restore.md`).

## 3a. Windows pilot server

### Why not point Docker at the share

Docker on Windows runs Linux containers in a VM, and that VM cannot see SMB shares:

- `BACKUP_PATH=X:\…` (a mapped drive) **looks like it works and does not.** The container gets an
  empty folder inside Docker's VM. Postgres archives into it, `backup.sh` reports success, and
  nothing reaches the NAS. Found on 2026-10-06; this is the most dangerous failure on this page,
  because nothing reports it.
- `BACKUP_PATH=\\nas\share\…` (UNC) is refused: "not a valid Windows path".
- A Docker volume with the `cifs` driver does work, but it stores the NAS password in the volume's
  options, where `docker volume inspect` shows it to anyone who can run Docker.

So the stack writes to a **local folder** and a scheduled task copies it to the NAS.

### Steps

1. Pick a local folder **on a different disk from Docker's data** if the server has one, e.g.
   `D:\dts-archive`. Set it in the stack's `.env`:

   ```
   BACKUP_PATH=D:/dts-archive
   ```

   Then `docker compose up -d postgres minio`. `wal/` appears under it within a minute; the archive
   command creates it.

2. Store the NAS account's password for Windows under the account the tasks will run as. That
   account also needs to run `docker`, so a local admin account dedicated to the service is
   simplest. Signed in as it:

   ```powershell
   cmdkey /add:<nas-address> /user:<nas-address>\dts-backup /pass
   ```

   `/pass` with no value asks for the password; type it yourself. Then check that
   `Test-Path \\<nas-address>\<share>\dts\.dts-archive` returns `True`. Use the **UNC path** in the
   tasks below, not a drive letter: a mapped drive exists only in an interactive sign-in session,
   and a scheduled task does not see it.

3. Register the two tasks, from an elevated PowerShell in the stack's checkout (here `C:\dts`).
   `Register-ScheduledTask` asks for that account's Windows password; type it yourself.

   ```powershell
   $user = "$env:COMPUTERNAME\dts-service"
   # Push the local archive to the NAS every minute (scripts/push-archive.ps1).
   $push = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory 'C:\dts' -Argument `
     '-NoProfile -ExecutionPolicy Bypass -File scripts\push-archive.ps1 -Source D:\dts-archive -Destination \\<nas-address>\<share>\dts'
   $everyMinute = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 1)
   Register-ScheduledTask 'DTS push archive to NAS' -Action $push -Trigger $everyMinute -User $user -Password (Read-Host 'Windows password' ) `
     -Settings (New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2))

   # Object mirror every 3 minutes: attachments meet the database's recovery point (P-13, D3).
   $mirror = New-ScheduledTaskAction -Execute 'C:\Program Files\Git\bin\bash.exe' -WorkingDirectory 'C:\dts' -Argument 'scripts/mirror-objects.sh'
   $every3 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 3)
   Register-ScheduledTask 'DTS object mirror' -Action $mirror -Trigger $every3 -User $user -Password (Read-Host 'Windows password') `
     -Settings (New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew)

   # Nightly base backup at 01:30 (it runs a mirror pass too).
   $backup = New-ScheduledTaskAction -Execute 'C:\Program Files\Git\bin\bash.exe' -WorkingDirectory 'C:\dts' -Argument 'scripts/backup.sh'
   Register-ScheduledTask 'DTS nightly base backup' -Action $backup -Trigger (New-ScheduledTaskTrigger -Daily -At 01:30) -User $user -Password (Read-Host 'Windows password')
   ```

   The scripts are Bash, so the server needs Git for Windows (its `bash.exe`). They export
   `MSYS_NO_PATHCONV` themselves (`backup-restore.md`, Developing on Windows). `MultipleInstances
   IgnoreNew` keeps a slow pass from overlapping the next.

4. Watch the first runs:

   ```powershell
   Get-Content $env:ProgramData\dts\push-archive.log -Tail 5    # rc=0..7 is success
   Get-ScheduledTask 'DTS*' | Get-ScheduledTaskInfo | Select-Object TaskName, LastRunTime, LastTaskResult
   ```

5. Register the freshness check, so a job that stops is noticed (every 5 minutes):

   ```powershell
   $check = New-ScheduledTaskAction -Execute 'C:\Program Files\Git\bin\bash.exe' -WorkingDirectory 'C:\dts' -Argument 'scripts/check-backup-freshness.sh --nas //<nas-address>/<share>/dts D:/dts-archive'
   $every5 = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
   Register-ScheduledTask 'DTS backup freshness' -Action $check -Trigger $every5 -User $user -Password (Read-Host 'Windows password') `
     -Settings (New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew)
   ```

   The script exits 1 when anything is stale, which Task Scheduler records as `LastTaskResult`
   1; that alone is not an alert. Set `ALERT_WEBHOOK_URL` in the task's environment (or have
   whoever is on call watch `Get-ScheduledTaskInfo 'DTS backup freshness'`) so it reaches a
   person. See [Freshness check](#freshness-check) for what it tests.

### What the local folder costs

The recovery point gains the push interval: a WAL segment closes within 60 s and reaches the NAS
within the next minute or so; an upload waits up to 3 minutes for a mirror pass, then up to a
minute for the push. So the worst case is about 2 minutes for records and about 4½ for files,
both inside P-13's 5. The D3 rehearsal measured 47 s and 3 min 1 s (evidence file). It ran the
mirror every 5 minutes, which is why the schedule is now 3: 5 minutes plus the push is about 6 in
the worst case.

The local folder grows like the NAS does. The push never deletes, so prune the local copy on the
same schedule as the NAS, and never prune it ahead of a successful push.

### Docker on Windows Server

Docker Desktop is not supported on Windows Server, and the stack's containers are Linux ones. On a
Windows server they run either in **WSL 2** with Docker Engine installed in the distro, or in a
**Linux VM** under Hyper-V. Decide which before installing:

- In **WSL 2**, the steps above apply. `BACKUP_PATH` is a Windows folder, e.g. `/mnt/d/dts-archive`,
  so the scheduled push can read it.
- In a **Linux VM**, use section 3b inside the VM instead. The VM mounts the share itself and none of
  this section is needed.

## 3b. Linux pilot server, or a Linux VM

As root. `cifs-utils` provides `mount.cifs`.

```bash
apt-get install -y cifs-utils            # or: dnf install -y cifs-utils
install -d -m 700 /etc/dts
install -m 600 /dev/null /etc/dts/nas-credentials
```

Edit `/etc/dts/nas-credentials` and type the account's details yourself. Never paste them into
chat, a ticket or the repository:

```
username=dts-backup
password=<the NAS account's password>
domain=<workgroup or domain, if the NAS uses one>
```

The mount, as one line in `/etc/fstab`:

```
//<nas-address>/<share>/dts  /mnt/dts-backup  cifs  credentials=/etc/dts/nas-credentials,vers=3.0,uid=70,gid=70,file_mode=0770,dir_mode=0770,_netdev,x-systemd.automount,nofail  0  0
```

`uid=70,gid=70`: Postgres runs as uid 70 in `postgres:16-alpine`, and an SMB share without Unix
extensions shows every file as owned by whoever the mount says. MinIO and the scripts run as root.

```bash
mkdir -p /mnt/dts-backup && systemctl daemon-reload && mount /mnt/dts-backup
findmnt -t cifs /mnt/dts-backup          # must print a line; nothing means it is NOT the NAS
test -f /mnt/dts-backup/.dts-archive && echo ok
```

Docker must not start before the share is mounted. A container started against an unmounted
`/mnt/dts-backup` writes WAL to the empty local folder under it, and mounting the share afterwards
does not reach into the running container (bind mounts are not propagated). So make the Docker
service wait for the mount:

```bash
systemctl edit docker      # add:  [Unit]  RequiresMountsFor=/mnt/dts-backup
systemctl daemon-reload
```

After a reboot, before trusting the stack, run `findmnt -t cifs /mnt/dts-backup` and
`test -f /mnt/dts-backup/.dts-archive && echo ok`; nothing printed means it is not the NAS.

Set `BACKUP_PATH=/mnt/dts-backup` in `.env`, then `docker compose up -d postgres minio`. The same
trap applies: if the share is not mounted, `/mnt/dts-backup` is an empty local folder and Docker
uses it without complaint. The jobs check the marker first. Root's crontab:

```
*/3 * * * *  cd /opt/dts && test -f /mnt/dts-backup/.dts-archive && flock -n /run/dts-mirror.lock bash scripts/mirror-objects.sh >> /var/log/dts-backup.log 2>&1
30 1 * * *   cd /opt/dts && test -f /mnt/dts-backup/.dts-archive && flock /run/dts-mirror.lock bash scripts/backup.sh >> /var/log/dts-backup.log 2>&1
```

And the freshness check, from the same crontab (see [Freshness check](#freshness-check)):

```
*/5 * * * *  cd /opt/dts && bash scripts/check-backup-freshness.sh --nas /mnt/dts-backup /mnt/dts-backup >> /var/log/dts-backup.log 2>&1 || logger -t dts-backup 'backup freshness check failed'
```

On Linux the archive and the NAS are the same mount, so `--nas` there verifies the markers and the
mount marker rather than a second copy.

**Not yet exercised:** Postgres's `archive_command` and the mirror writing to a CIFS mount from
inside a container. The D3 rehearsal could not test it (its Windows workstation cannot mount the
share into Docker without storing the password). The ownership options above are the usual answer.
The checks in section 4 catch it if they are not.

## Freshness check

`scripts/check-backup-freshness.sh` is the alarm for P-13. Each job leaves a proof of its last good
run: `mirror-objects.sh` touches `.status/objects` and `backup.sh` touches `.status/base` in the
archive, and the push carries them to the NAS with their times. The check reads those, so it
notices a job that has stopped even though the last good copy is still sitting there.

| Check | Stale when |
| --- | --- |
| `objects` | the last good mirror pass is more than 7 minutes old (one missed pass plus the push) |
| `base` | the last good base backup is more than 26 hours old |
| `archiver` | the postgres container is not running, or `pg_stat_archiver` shows a failure after its last success (skipped only when `docker` is absent) |
| `nas-push` | `.status/pushed` on the NAS is more than 5 minutes old. `push-archive.ps1` writes it only after a whole successful copy, so a push that copied the markers and then failed on a later file shows up here |
| `nas-obj`, `nas-base` | the same two markers on the NAS are stale or missing |
| `nas-wal` | the newest local WAL segment old enough to have been pushed is not on the NAS |
| `nas` | the share has no `.dts-archive` marker (not mounted, or not the NAS) |

WAL is judged by the archiver and by the NAS comparison, not by file age: Postgres closes a segment
each minute only while there is activity, so an idle night would look stale. Thresholds can be set
with `OBJECTS_MAX_AGE`, `BASE_MAX_AGE` and `PUSH_GRACE` (seconds). It is a check on the jobs, not a
restore: the rehearsal in section 4 is still the proof that the copies are usable.

## 4. Before calling it done

- [ ] On the NAS, the folder holds `wal/`, `base/` and `objects/`, viewed **from another machine**.
      That proves the files are on the NAS, not in a local folder with the same name.
- [ ] `select pg_switch_wal()`, then within two minutes that segment is on the NAS.
- [ ] `select failed_count from pg_stat_archiver` is 0.
- [ ] The mirror runs every 3 minutes and the base backup nightly: check the task history or
      `/var/log/dts-backup.log`.
- [ ] `bash scripts/check-backup-freshness.sh --nas <nas> <archive>` prints no `STALE` line. Then
      stop the push for 10 minutes and confirm the check fails and the alert reaches a person.
- [ ] A restore has been rehearsed from the NAS (`backup-restore.md`, Rehearsing).

## Restoring onto a replacement server

Set up the replacement with sections 2 and 3, but **do not start the scheduled jobs** and do not
point `BACKUP_PATH` at the NAS archive itself. Copy the archive down instead, then restore from the
copy:

```powershell
robocopy \\<nas-address>\<share>\dts D:\dts-restore /E /R:2 /W:5 /NP
```

and set `BACKUP_PATH=D:/dts-restore` (on Linux: `rsync -a /mnt/dts-backup/ /srv/dts-restore/`). A
replacement that archives into the archive it is restoring from is the one thing that can damage
it: its new timeline's WAL lands beside the old. Then follow `backup-restore.md`, Restoring. Once
the restored system is accepted, point `BACKUP_PATH` at its permanent local folder (or the mount)
and start the jobs. The first push then writes the new timeline to the NAS next to the old one,
which is safe: segment names carry their timeline.
