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

  /**
   * Decision 152's other half. The risk in this migration is not its shape — it adds one section
   * row — but its data half: it moves placement across every table that names a division, and it
   * must do so without touching a single `reference_number`. Decision 153 makes already-issued
   * `RECORDS-<year>-<n>` references permanent, and they exist on paper.
   */
  describe('0009 the Records Unit becomes a Section inside the ORD', () => {
    const RECORDS_DIVISION = '33333333-3333-4333-8333-333333333333';
    const INTAKE_SECTION = '44444444-4444-4444-8444-444444444444';
    const OFFICER = '55555555-5555-4555-8555-555555555555';

    beforeAll(async () => {
      await resetSchema();
      await migrate(database, {
        migrationsFolder: await migrationsThrough('0008_reference_documents'),
      });

      await database.execute(
        sql.raw(`
        INSERT INTO divisions (id, code, name) VALUES
          ('${RECORDS_DIVISION}', 'RECORDS', 'Records Office');

        INSERT INTO sections (id, division_id, code, name)
        VALUES ('${INTAKE_SECTION}', '${RECORDS_DIVISION}', 'INTAKE', 'Intake');

        INSERT INTO users (id, email, display_name, password_hash, role, division_id, section_id)
        VALUES ('${OFFICER}', 'officer@dts.local', 'Records Officer', 'not-a-real-hash',
                'RECORDS_STAFF', '${RECORDS_DIVISION}', '${INTAKE_SECTION}');

        -- An outgoing document already stamped with the retiring division's prefix, and an
        -- incoming one that was never narrowed to a section.
        INSERT INTO documents (tracking_number, reference_number, title, type, priority, direction,
                               status, division_id, section_id, created_by_id)
        VALUES ('DTS-2026-000900', 'RECORDS-2026-00001', 'Outgoing reply', 'LETTER', 'NORMAL',
                'OUTGOING', 'RELEASED', '${RECORDS_DIVISION}', '${INTAKE_SECTION}', '${OFFICER}'),
               ('DTS-2026-000901', NULL, 'Incoming request', 'MEMORANDUM', 'NORMAL',
                'INCOMING', 'IN_PROCESS', '${RECORDS_DIVISION}', NULL, '${OFFICER}');

        -- How far the retiring division's yearly sequence got.
        INSERT INTO reference_counters (division_id, year, value)
        VALUES ('${RECORDS_DIVISION}', 2026, 1);

        INSERT INTO document_routes (document_id, to_division_id, to_section_id, routed_by_id)
        SELECT id, '${RECORDS_DIVISION}', '${INTAKE_SECTION}', created_by_id
        FROM documents WHERE tracking_number = 'DTS-2026-000901';

        -- An open request for a placement that is about to stop being legal, and a decided one
        -- whose record of what was asked for must not be rewritten.
        INSERT INTO account_requests (email, display_name, password_hash, status,
                                      requested_division_id, requested_section_id)
        VALUES ('open@dts.local', 'Open Applicant', 'not-a-real-hash', 'PENDING',
                '${RECORDS_DIVISION}', '${INTAKE_SECTION}'),
               ('closed@dts.local', 'Closed Applicant', 'not-a-real-hash', 'REJECTED',
                '${RECORDS_DIVISION}', '${INTAKE_SECTION}');
      `),
      );

      await migrate(database, { migrationsFolder });
    });

    /** The whole risk in A1/A2, and the reason the migration moves placement and nothing else. */
    it('leaves already-issued reference numbers untouched', async () => {
      const result = await database.execute(
        sql.raw(`SELECT reference_number FROM documents WHERE tracking_number = 'DTS-2026-000900'`),
      );
      expect(result.rows[0]).toEqual({ reference_number: 'RECORDS-2026-00001' });
    });

    it('repoints documents into the ORD and its Records Unit, preserving an absent section', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT d.tracking_number, dv.code AS division, s.code AS section
        FROM documents d
        JOIN divisions dv ON dv.id = d.division_id
        LEFT JOIN sections s ON s.id = d.section_id
        ORDER BY d.tracking_number
      `),
      );

      expect(result.rows).toEqual([
        { tracking_number: 'DTS-2026-000900', division: 'ORD', section: 'RECORDS' },
        // Division-wide before, division-wide after: the migration must not narrow a scope.
        { tracking_number: 'DTS-2026-000901', division: 'ORD', section: null },
      ]);
    });

    /**
     * The point of the exercise: the records officer now sits inside the ORD, so a draft it
     * registers is owned by the ORD and takes the `FOR_SIGNATURE` path (ADR-0007).
     */
    it('repoints the records officer into the ORD', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT dv.code AS division, s.code AS section, s.name AS section_name
        FROM users u
        JOIN divisions dv ON dv.id = u.division_id
        JOIN sections s ON s.id = u.section_id
        WHERE u.email = 'officer@dts.local'
      `),
      );
      expect(result.rows[0]).toEqual({
        division: 'ORD',
        section: 'RECORDS',
        section_name: 'Records Unit',
      });
    });

    it('repoints route recipients, so the unit that now holds a document can still read it', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT dv.code AS division, s.code AS section
        FROM document_routes r
        JOIN divisions dv ON dv.id = r.to_division_id
        LEFT JOIN sections s ON s.id = r.to_section_id
      `),
      );
      expect(result.rows[0]).toEqual({ division: 'ORD', section: 'RECORDS' });
    });

    /**
     * An open request would otherwise be unapprovable, because `resolvePlacement` refuses an
     * inactive division. A decided one is a record of what was asked for and granted, so it keeps
     * pointing where it pointed.
     */
    it('repoints open account requests and leaves decided ones as they were recorded', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT a.email, dv.code AS division
        FROM account_requests a
        JOIN divisions dv ON dv.id = a.requested_division_id
        ORDER BY a.email
      `),
      );
      expect(result.rows).toEqual([
        { email: 'closed@dts.local', division: 'RECORDS' },
        { email: 'open@dts.local', division: 'ORD' },
      ]);
    });

    /**
     * Deactivated, never deleted — decision 152 is explicit, because division codes are embedded
     * in reference numbers already issued. Its counter row survives with it, which is what makes
     * the move reversible and what stops a number ever being reissued.
     */
    it('deactivates the RECORDS division rather than dropping it, and keeps its counter', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT d.active AS division_active,
               (SELECT bool_and(s.active) FROM sections s WHERE s.division_id = d.id)
                 AS sections_active,
               (SELECT value FROM reference_counters c
                WHERE c.division_id = d.id AND c.year = 2026) AS counter
        FROM divisions d WHERE d.code = 'RECORDS'
      `),
      );
      expect(result.rows[0]).toEqual({
        division_active: false,
        sections_active: false,
        counter: 1,
      });
    });
  });

  /**
   * Release methods stop being a pgEnum and become configurable rows (policy register P-15). The
   * case that matters is the backfill: four enum values have to map forward onto six seeded rows
   * without any release losing the record of how it left the office.
   */
  describe('0010 configurable release methods', () => {
    const previousMethods = ['MAILED', 'EMAILED', 'PICKED_UP', 'DELIVERED'];

    beforeAll(async () => {
      await resetSchema();
      await migrate(database, {
        migrationsFolder: await migrationsThrough('0009_records_unit_as_ord_section'),
      });

      await database.execute(
        sql.raw(`
        INSERT INTO divisions (id, code, name)
        VALUES ('66666666-6666-4666-8666-666666666666', 'LEGACY', 'Legacy Division');

        INSERT INTO users (id, email, display_name, password_hash, role, division_id)
        VALUES ('77777777-7777-4777-8777-777777777777', 'releaser@dts.local', 'Releaser',
                'not-a-real-hash', 'RECORDS_STAFF', '66666666-6666-4666-8666-666666666666');
      `),
      );

      // One document per release: `release_events.document_id` is unique, because a document
      // leaves the office once.
      for (const [index, method] of previousMethods.entries()) {
        await database.execute(
          sql.raw(`
          INSERT INTO documents (tracking_number, title, type, priority, direction, status,
                                 division_id, created_by_id)
          VALUES ('DTS-2026-00100${index}', 'Released ${method}', 'LETTER', 'NORMAL', 'OUTGOING',
                  'RELEASED', '66666666-6666-4666-8666-666666666666',
                  '77777777-7777-4777-8777-777777777777');

          INSERT INTO release_events (document_id, released_by_id, method)
          SELECT id, created_by_id, '${method}' FROM documents
          WHERE tracking_number = 'DTS-2026-00100${index}';
        `),
        );
      }

      await migrate(database, { migrationsFolder });
    });

    it('seeds the six configured methods, flagging the two that issue a tracking number', async () => {
      const result = await database.execute(
        sql.raw(
          `SELECT code, label, requires_tracking_reference FROM release_methods ORDER BY sort_order`,
        ),
      );
      expect(result.rows).toEqual([
        { code: 'EMAILED', label: 'Emailed', requires_tracking_reference: false },
        { code: 'POSTAL', label: 'Postal', requires_tracking_reference: false },
        { code: 'LBC', label: 'LBC', requires_tracking_reference: true },
        { code: 'JRS', label: 'JRS', requires_tracking_reference: true },
        { code: 'PICKED_UP', label: 'Picked up', requires_tracking_reference: false },
        {
          code: 'PERSONALLY_DELIVERED',
          label: 'Personally delivered',
          requires_tracking_reference: false,
        },
      ]);
    });

    /**
     * `MAILED → POSTAL` and `DELIVERED → PERSONALLY_DELIVERED` are the two renames. The mapping of
     * `MAILED` is still awaiting confirmation from the Records section; what this asserts is that
     * the migration applied the mapping it documents, so a correction is a re-point rather than an
     * archaeology exercise.
     */
    it('maps every stored enum value forward without losing a release', async () => {
      const result = await database.execute(
        sql.raw(`
        SELECT d.title, m.code
        FROM release_events e
        JOIN documents d ON d.id = e.document_id
        JOIN release_methods m ON m.id = e.method_id
        ORDER BY d.tracking_number
      `),
      );
      expect(result.rows).toEqual([
        { title: 'Released MAILED', code: 'POSTAL' },
        { title: 'Released EMAILED', code: 'EMAILED' },
        { title: 'Released PICKED_UP', code: 'PICKED_UP' },
        { title: 'Released DELIVERED', code: 'PERSONALLY_DELIVERED' },
      ]);
    });

    it('removes the release_method type entirely', async () => {
      const result = await database.execute(sql.raw(`SELECT to_regtype('release_method') AS type`));
      expect(result.rows[0]).toEqual({ type: null });
    });
  });
});
