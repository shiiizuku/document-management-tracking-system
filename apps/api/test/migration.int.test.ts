import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for destructive migration tests');

const pool = new Pool({ connectionString: databaseUrl });
const database = drizzle(pool);

describe('database migrations', () => {
  beforeAll(async () => {
    // Drizzle keeps its applied-migration journal in a separate `drizzle` schema, so
    // dropping only `public` would leave the migrator believing everything is already
    // applied — the suite would then pass once and fail on every re-run.
    await database.execute(
      sql.raw(
        'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      ),
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies every migration to an empty PostgreSQL database', async () => {
    await migrate(database, {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });

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
});
