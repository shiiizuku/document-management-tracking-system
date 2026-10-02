import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for destructive migration tests');

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

const resetSchema = async (): Promise<void> => {
  // Drizzle keeps its applied-migration journal in a separate `drizzle` schema, so
  // dropping only `public` would leave the migrator believing everything is already
  // applied — the suite would then pass once and fail on every re-run.
  await database.execute(
    sql.raw(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
    ),
  );
};

/**
 * A copy of the migrations folder whose journal stops at `throughTag`.
 *
 * Needed because a data migration can only be tested against data that predates it: the rows have
 * to be inserted while the old schema is still in place. Drizzle has no "migrate to version N", so
 * the journal is trimmed instead and the full folder is replayed afterwards — the migrator skips
 * what it has already recorded and applies only the rest.
 */
const migrationsThrough = async (throughTag: string): Promise<string> => {
  const folder = await mkdtemp(join(tmpdir(), 'dts-migrations-'));
  await cp(migrationsFolder, folder, { recursive: true });
  const journalPath = join(folder, 'meta', '_journal.json');
  const journal = JSON.parse(await readFile(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const cutoff = journal.entries.findIndex((entry) => entry.tag === throughTag);
  if (cutoff === -1) throw new Error(`No migration tagged ${throughTag}`);
  journal.entries = journal.entries.slice(0, cutoff + 1);
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  return folder;
};

describe('database migrations', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('applies every migration to an empty PostgreSQL database', async () => {
    await resetSchema();
    await migrate(database, { migrationsFolder });

    const result = await database.execute(
      sql.raw(`
      SELECT
        to_regclass('public.audit_events') AS audit_events,
        to_regclass('public.outbox_events') AS outbox_events,
        to_regclass('public.documents') AS documents
    `),
    );

    expect(result.rows[0]).toEqual({
      audit_events: 'audit_events',
      outbox_events: 'outbox_events',
      documents: 'documents',
    });
  });

  /**
   * The custody-acceptance migration is the first one in this project that rewrites data rather
   * than only shape, and it rewrites the column the whole workflow turns on. The cases that matter
   * are the two it must treat differently: a `PENDING` document, which was registered and never
   * accepted and must stay pending under the new derived rule, and every other document, whose
   * status is a statement about work already done and must not move.
   */
  describe('0005 custody acceptance and status vocabulary', () => {
    const previousStatuses = [
      'PENDING',
      'IN_PROCESS',
      'FOR_REVISION',
      'FOR_SIGNATURE',
      'SIGNED',
      'FOR_RELEASE',
      'RELEASED',
      'ARCHIVED',
    ];

    beforeAll(async () => {
      await resetSchema();
      await migrate(database, {
        migrationsFolder: await migrationsThrough('0004_loving_inhumans'),
      });

      await database.execute(
        sql.raw(`
        INSERT INTO divisions (id, code, name)
        VALUES ('11111111-1111-4111-8111-111111111111', 'LEGACY', 'Legacy Division');

        INSERT INTO users (id, email, display_name, password_hash, role, division_id)
        VALUES ('22222222-2222-4222-8222-222222222222', 'legacy@dts.local', 'Legacy User',
                'not-a-real-hash', 'RECORDS_STAFF', '11111111-1111-4111-8111-111111111111');
      `),
      );

      for (const [index, status] of previousStatuses.entries()) {
        await database.execute(
          sql.raw(`
          INSERT INTO documents (tracking_number, title, type, priority, direction, status,
                                 division_id, created_by_id)
          VALUES ('DTS-2026-${String(index).padStart(6, '0')}', 'Document ${status}', 'MEMORANDUM',
                  'NORMAL', 'INCOMING', '${status}',
                  '11111111-1111-4111-8111-111111111111',
                  '22222222-2222-4222-8222-222222222222');
        `),
        );
      }

      // A hop recorded under the old schema, which had no acceptance columns at all.
      await database.execute(
        sql.raw(`
        INSERT INTO document_routes (document_id, to_division_id, routed_by_id)
        SELECT id, division_id, created_by_id FROM documents WHERE status = 'RELEASED';
      `),
      );

      await migrate(database, { migrationsFolder });
    });

    it('moves PENDING documents to IN_PROCESS and leaves every other status alone', async () => {
      const result = await database.execute(
        sql.raw(`SELECT title, status::text AS status FROM documents ORDER BY tracking_number`),
      );
      const byTitle = new Map(
        result.rows.map((row) => [row.title as string, row.status as string]),
      );

      expect(byTitle.get('Document PENDING')).toBe('IN_PROCESS');
      for (const status of previousStatuses.filter((candidate) => candidate !== 'PENDING')) {
        expect(byTitle.get(`Document ${status}`)).toBe(status);
      }
    });

    it('gives each former PENDING document an unaccepted route, so it is still pending', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT d.title,
               EXISTS (SELECT 1 FROM document_routes r
                       WHERE r.document_id = d.id AND r.accepted_at IS NULL) AS pending
        FROM documents d
        ORDER BY d.tracking_number
      `),
      );
      const byTitle = new Map(result.rows.map((row) => [row.title as string, row.pending]));

      expect(byTitle.get('Document PENDING')).toBe(true);
      // A document that was already being worked is not retroactively made outstanding.
      expect(byTitle.get('Document IN_PROCESS')).toBe(false);
      expect(byTitle.get('Document RELEASED')).toBe(false);
    });

    it('backfills pre-existing hops as accepted by whoever routed them', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT r.accepted_at IS NOT NULL AS accepted, r.accepted_by_id = r.routed_by_id AS self
        FROM document_routes r
        JOIN documents d ON d.id = r.document_id
        WHERE d.title = 'Document RELEASED'
      `),
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({ accepted: true, self: true });
    });

    it('removes PENDING from the status type entirely', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT e.enumlabel AS label
        FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'workflow_status'
        ORDER BY e.enumsortorder
      `),
      );

      expect(result.rows.map((row) => row.label)).toEqual([
        'IN_PROCESS',
        'FOR_REVISION',
        'FOR_INITIAL',
        'FOR_SIGNATURE',
        'SIGNED',
        'FOR_RELEASE',
        'RELEASED',
        'COMPLIED',
        'ARCHIVED',
      ]);
    });

    /**
     * The timeline is evidence, so the migration must not rewrite it. A hop recorded as entering
     * `PENDING` still says so — which is why these columns became free text rather than being
     * re-pointed at the new enum.
     */
    it('preserves historical status names in the workflow timeline', async () => {
      await database.execute(
        sql.raw(`
        INSERT INTO workflow_events (document_id, sequence, actor_id, action, from_status, to_status)
        SELECT id, 1, created_by_id, 'ACCEPT', 'PENDING', 'IN_PROCESS'
        FROM documents WHERE title = 'Document IN_PROCESS';
      `),
      );

      const result = await database.execute(
        sql.raw(`SELECT from_status, to_status FROM workflow_events WHERE from_status = 'PENDING'`),
      );
      expect(result.rows[0]).toMatchObject({ from_status: 'PENDING', to_status: 'IN_PROCESS' });
    });
  });
});
