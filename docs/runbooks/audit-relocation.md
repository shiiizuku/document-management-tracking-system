# Runbook: audit relocation

Policy register **P-08**: audit events are retained **5 years** in the primary database and are
**never purged**; after 5 years they are moved to a separate database.

For the first five years of the pilot there is nothing to do, and that is the correct behaviour.
The primary database keeps every audit event it has ever written. The first event becomes eligible
in 2031. This runbook exists so that day's job is a command someone runs, not a script someone
writes under pressure.

## What stops a purge

Two layers, so a purge cannot arrive by accident:

- **The table refuses it.** Migration `0012` puts triggers on `audit_events`. `UPDATE` is always
  refused. `DELETE` and `TRUNCATE` are refused unless the session has set
  `dts.allow_audit_removal = on`. That setting is used in exactly two places: the relocator, and
  the end-to-end suite's reset of its own disposable database.
- **Review refuses it.** `apps/api/test/audit-relocation.test.ts` scans the repository and fails if
  a third place sets the override, deletes audit rows, truncates the table, or updates it.

Neither layer is a security boundary. Any role that can run SQL can set a custom setting. They stop
mistakes: a "cleanup" job, a stray `DELETE`, a table name added to a TRUNCATE list. They do not stop
a hostile administrator. The boundary is withholding `UPDATE`/`DELETE` on `audit_events` from the
application's runtime role, and that is still an open M6 item.

## Where the archive lives

The archive is **not decided yet**: IT operations is to name the host. Whatever it is, it is
configured as `AUDIT_ARCHIVE_DATABASE_URL`, and it must be a different database from
`DATABASE_URL`. The command refuses to run otherwise.

The relocator creates the archive's one table, `audit_events_archive`, on first run. That table has
the same columns as `audit_events` plus `relocated_at`, and no foreign keys, because the users and
documents its rows name stay in the primary. Triggers make it append-only **with no override**:
nothing is ever removed from the archive.

Back up the archive as you would the primary. Relocated rows exist nowhere else, and P-13's backup
covers only the primary.

## Running it

```bash
AUDIT_ARCHIVE_DATABASE_URL=postgresql://… npm run audit:relocate -w @dts/api
```

The command moves every event older than five years in batches of 5,000 and prints the total. The
cutoff is always computed from the current time; there is no flag to move younger rows.

You can **rerun it** at any time, and you can **interrupt** it. Each batch:

1. locks the eligible rows in the primary;
2. copies them into the archive, ignoring ids the archive already holds;
3. reads back a fingerprint of every archived row and compares it with the primary's;
4. deletes from the primary **only** the rows whose fingerprints matched, then commits.

If the command is interrupted before step 4, the rows are still in the primary. The next run
re-copies them, which changes nothing, and then deletes them. Timestamps travel as Postgres JSON
rather than JavaScript dates, so microseconds survive the move.

## When it stops with a mismatch

`The archive holds a different row under N id(s)…` means the archive already has a row with the
same id as one being relocated, and the two rows differ. **Nothing was deleted for those ids.** Do
not resolve this by picking one copy. Compare the two rows, find out how the archive came to hold a
different one, and settle it with the records and legal owners before rerunning. Rows that did
match in the same batch were relocated normally.

## Verified by

`apps/api/test/audit-relocation.int.test.ts`, against real Postgres with a second database as the
archive. It checks:

- only rows older than five years move;
- a row exactly five years old stays;
- moved rows arrive byte for byte, microseconds included;
- every batch is processed, and a rerun does nothing;
- a run interrupted after the copy finishes cleanly;
- a mismatched archive row leaves the primary row in place;
- both tables refuse every removal and edit they are meant to refuse.
