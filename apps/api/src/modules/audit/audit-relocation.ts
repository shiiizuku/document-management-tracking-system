import type { Pool, PoolClient } from 'pg';

/**
 * P-08: audit events are kept **five years** in the primary database and then **moved** to a
 * separate one. They are never purged.
 *
 * For the first five years of the pilot the correct behaviour is the one already running — every
 * row stays where it is written — so this is not a retention window and nothing schedules it. It
 * is the relocation path the policy promises, built and tested now so that the first relocation,
 * due in 2031, is a command someone runs rather than a script someone writes under pressure.
 *
 * ## Why a row can never be lost
 *
 * The two databases cannot share a transaction, so the order of operations is the guarantee:
 *
 * 1. Lock a batch of rows older than the cutoff in the primary (`FOR UPDATE`).
 * 2. Copy them into the archive (`ON CONFLICT DO NOTHING`, so a rerun after a crash is harmless).
 * 3. Read back from the archive a fingerprint of every row it now holds for those ids, and compare
 *    it with the same fingerprint computed in the primary.
 * 4. Delete from the primary **only the ids whose fingerprints matched**, then commit.
 *
 * A crash anywhere before step 4 leaves the row in the primary (and possibly also in the archive,
 * which the next run's step 2 absorbs). A mismatch — an archive row with the same id but
 * different content — leaves the primary row in place and stops the run, because that is a
 * question for a person, not something to resolve by choosing a winner.
 *
 * The rows are carried as `row_to_json` text rather than through JavaScript values: a JS `Date`
 * holds milliseconds and Postgres holds microseconds, and a relocation that rounded every
 * timestamp would be rewriting the evidence it exists to preserve.
 */

export const AUDIT_RETENTION_YEARS = 5;

/** The newest instant a row may have been written and still be relocated, relative to `now`. */
export const relocationCutoff = (now: Date): Date => {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - AUDIT_RETENTION_YEARS);
  return cutoff;
};

/**
 * The archive's table. Created by the relocator rather than by the primary's migrations, because
 * it lives in a different database whose location IT operations has not named yet (the one input
 * D4 still needs). It carries no foreign keys — the users and documents it names stay behind in
 * the primary — and it is append-only by trigger, with no override at all: nothing is ever
 * removed from the archive.
 */
export const ARCHIVE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS audit_events_archive (
  id uuid PRIMARY KEY,
  actor_id uuid,
  action varchar(100) NOT NULL,
  target_type varchar(80) NOT NULL,
  target_id varchar(160) NOT NULL,
  outcome text NOT NULL,
  correlation_id uuid NOT NULL,
  source_ip varchar(64),
  summary jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  relocated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_archive_occurred_idx ON audit_events_archive (occurred_at);
CREATE OR REPLACE FUNCTION audit_events_archive_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_archive is append-only (policy P-08)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
DROP TRIGGER IF EXISTS audit_events_archive_append_only ON audit_events_archive;
CREATE TRIGGER audit_events_archive_append_only BEFORE UPDATE OR DELETE ON audit_events_archive
  FOR EACH ROW EXECUTE FUNCTION audit_events_archive_guard();
DROP TRIGGER IF EXISTS audit_events_archive_no_truncate ON audit_events_archive;
CREATE TRIGGER audit_events_archive_no_truncate BEFORE TRUNCATE ON audit_events_archive
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_archive_guard();
`;

/**
 * One canonical text per row, computed identically on both sides. `outcome` is an enum in the
 * primary and text in the archive, and `summary::text` is jsonb's normalized form in both, so
 * equal rows produce equal fingerprints whichever database computes them.
 */
const FINGERPRINT = `md5(concat_ws('|', id::text, coalesce(actor_id::text, '∅'), action, target_type,
  target_id, outcome::text, correlation_id::text, coalesce(source_ip, '∅'), summary::text,
  to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')))`;

const COLUMNS =
  'id, actor_id, action, target_type, target_id, outcome, correlation_id, source_ip, summary, occurred_at';

export interface RelocationResult {
  relocated: number;
  batches: number;
  cutoff: Date;
}

export class AuditRelocationMismatchError extends Error {
  constructor(readonly ids: string[]) {
    super(
      `The archive holds a different row under ${ids.length} id(s) being relocated ` +
        `(first: ${ids[0]}). Nothing was deleted for them; reconcile by hand before rerunning.`,
    );
  }
}

export class AuditRelocator {
  constructor(
    private readonly primary: Pool,
    private readonly archive: Pool,
  ) {}

  async ensureArchiveSchema(): Promise<void> {
    await this.archive.query(ARCHIVE_SCHEMA_SQL);
  }

  /**
   * Moves every audit event older than the retention period. `now` is injectable for tests; the
   * cutoff is always derived from it, never passed in, so no caller can relocate a row younger
   * than five years.
   */
  async relocate(options: { now?: Date; batchSize?: number } = {}): Promise<RelocationResult> {
    const cutoff = relocationCutoff(options.now ?? new Date());
    const batchSize = options.batchSize ?? 5_000;
    await this.ensureArchiveSchema();
    let relocated = 0;
    let batches = 0;
    for (;;) {
      const moved = await this.relocateBatch(cutoff, batchSize);
      if (moved === 0) break;
      relocated += moved;
      batches += 1;
    }
    return { relocated, batches, cutoff };
  }

  private async relocateBatch(cutoff: Date, batchSize: number): Promise<number> {
    const client = await this.primary.connect();
    try {
      await client.query('BEGIN');
      const batch = await this.leaseBatch(client, cutoff, batchSize);
      if (batch.ids.length === 0) {
        await client.query('ROLLBACK');
        return 0;
      }

      await this.archive.query(
        `INSERT INTO audit_events_archive (${COLUMNS})
         SELECT ${COLUMNS} FROM json_populate_recordset(NULL::audit_events_archive, $1::json)
         ON CONFLICT (id) DO NOTHING`,
        [batch.json],
      );
      const archived = await this.archive.query<{ id: string; fingerprint: string }>(
        `SELECT id::text, ${FINGERPRINT} AS fingerprint
         FROM audit_events_archive WHERE id = ANY($1::uuid[])`,
        [batch.ids],
      );
      const archivedFingerprint = new Map(archived.rows.map((row) => [row.id, row.fingerprint]));
      const verified = batch.ids.filter(
        (id) => archivedFingerprint.get(id) === batch.fingerprints.get(id),
      );
      const mismatched = batch.ids.filter(
        (id) =>
          archivedFingerprint.has(id) && archivedFingerprint.get(id) !== batch.fingerprints.get(id),
      );

      if (verified.length > 0) {
        // The only place in the application that may remove an audit row; see migration 0012.
        await client.query(`SET LOCAL dts.allow_audit_removal = 'on'`);
        await client.query(
          'DELETE FROM audit_events WHERE id = ANY($1::uuid[]) AND occurred_at < $2',
          [verified, cutoff],
        );
      }
      await client.query('COMMIT');
      if (mismatched.length > 0) throw new AuditRelocationMismatchError(mismatched);
      // A batch whose copy failed to land for every row would otherwise loop forever.
      if (verified.length < batch.ids.length)
        throw new Error(
          `${batch.ids.length - verified.length} audit row(s) were not found in the archive after ` +
            'copying; nothing was deleted for them.',
        );
      return verified.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async leaseBatch(client: PoolClient, cutoff: Date, batchSize: number) {
    const { rows } = await client.query<{ id: string; fingerprint: string; row: string }>(
      `SELECT id::text, ${FINGERPRINT} AS fingerprint, row_to_json(audit_events)::text AS row
       FROM audit_events
       WHERE occurred_at < $1
       ORDER BY occurred_at, id
       LIMIT $2
       FOR UPDATE`,
      [cutoff, batchSize],
    );
    return {
      ids: rows.map((row) => row.id),
      fingerprints: new Map(rows.map((row) => [row.id, row.fingerprint])),
      json: `[${rows.map((row) => row.row).join(',')}]`,
    };
  }
}
