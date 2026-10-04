import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client, Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AuditRelocationMismatchError,
  AuditRelocator,
} from '../src/modules/audit/audit-relocation.js';

/**
 * P-08 against real Postgres: audit events older than five years move to a separate database, and
 * nothing — not the application, not a stray statement — purges them from either side.
 *
 * The archive is a second database beside the suite's own (`<name>_audit_archive`), because the
 * property under test is that rows survive a move *between databases*, which no single-database
 * fixture can show.
 */

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for destructive integration tests');

const archiveUrl = (() => {
  const url = new URL(databaseUrl);
  url.pathname = `${url.pathname}_audit_archive`;
  return url.toString();
})();

const primary = new Pool({ connectionString: databaseUrl, max: 3 });
const archive = new Pool({ connectionString: archiveUrl, max: 3 });
const relocator = new AuditRelocator(primary, archive);

// A fixed "now" five-and-a-bit years into the pilot, so the cutoff is 2026-03-01.
const NOW = new Date('2031-03-01T00:00:00.000Z');

const insertEvent = async (occurredAt: string, summary: object = {}): Promise<string> => {
  const id = randomUUID();
  await primary.query(
    `INSERT INTO audit_events (id, action, target_type, target_id, outcome, correlation_id,
                               source_ip, summary, occurred_at)
     VALUES ($1, 'document.created', 'document', $2, 'SUCCESS', $3, '10.0.0.7', $4, $5)`,
    [id, randomUUID(), randomUUID(), JSON.stringify(summary), occurredAt],
  );
  return id;
};

const primaryIds = async (): Promise<string[]> =>
  (
    await primary.query<{ id: string }>('SELECT id::text FROM audit_events ORDER BY occurred_at')
  ).rows.map((row) => row.id);

beforeAll(async () => {
  const maintenance = new URL(databaseUrl);
  maintenance.pathname = '/postgres';
  const client = new Client({ connectionString: maintenance.toString() });
  await client.connect();
  try {
    const name = new URL(archiveUrl).pathname.slice(1);
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  await primary.query(
    'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
  );
  await migrate(drizzle(primary), {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
  });
});

beforeEach(async () => {
  // The archive refuses TRUNCATE by design, so the suite starts each case from a fresh schema.
  await archive.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const client = await primary.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL dts.allow_audit_removal = 'on'`);
    await client.query('TRUNCATE audit_events');
    await client.query('COMMIT');
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await Promise.all([primary.end(), archive.end()]);
});

describe('audit relocation (P-08)', () => {
  it('moves only rows older than five years, byte for byte', async () => {
    const old = await insertEvent('2025-07-14T09:30:15.123456Z', {
      trackingNumber: 'DTS-2025-000001',
    });
    const boundary = await insertEvent('2026-03-01T00:00:00.000000Z');
    const young = await insertEvent('2029-01-01T00:00:00.000000Z');

    const result = await relocator.relocate({ now: NOW, batchSize: 1 });

    expect(result).toMatchObject({ relocated: 1, batches: 1 });
    // Exactly five years old is not yet older than five years.
    expect(await primaryIds()).toEqual([boundary, young]);
    const { rows } = await archive.query(
      `SELECT id::text, outcome, source_ip, summary,
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS occurred
       FROM audit_events_archive`,
    );
    // Microseconds survive: the rows travel as Postgres JSON, never as JavaScript dates.
    expect(rows).toEqual([
      {
        id: old,
        outcome: 'SUCCESS',
        source_ip: '10.0.0.7',
        summary: { trackingNumber: 'DTS-2025-000001' },
        occurred: '2025-07-14T09:30:15.123456',
      },
    ]);
  });

  it('walks every batch and is a no-op when rerun', async () => {
    for (let i = 0; i < 7; i++) await insertEvent(`2024-0${i + 1}-01T00:00:00Z`);

    expect(await relocator.relocate({ now: NOW, batchSize: 3 })).toMatchObject({
      relocated: 7,
      batches: 3,
    });
    expect(await relocator.relocate({ now: NOW, batchSize: 3 })).toMatchObject({ relocated: 0 });
    expect(await primaryIds()).toEqual([]);
    const archived = await archive.query('SELECT count(*)::int AS n FROM audit_events_archive');
    expect(archived.rows[0]).toEqual({ n: 7 });
  });

  it('finishes a relocation that was interrupted after the copy', async () => {
    const id = await insertEvent('2024-05-05T00:00:00Z');
    // The state a crash between the archive insert and the primary delete leaves behind.
    await relocator.ensureArchiveSchema();
    await archive.query(
      `INSERT INTO audit_events_archive (id, action, target_type, target_id, outcome,
                                         correlation_id, source_ip, summary, occurred_at)
       SELECT id, action, target_type, target_id, outcome::text, correlation_id, source_ip,
              summary, occurred_at
       FROM json_populate_record(NULL::audit_events_archive, $1::json)`,
      [(await primary.query('SELECT row_to_json(a)::text AS r FROM audit_events a')).rows[0].r],
    );

    expect(await relocator.relocate({ now: NOW })).toMatchObject({ relocated: 1 });
    expect(await primaryIds()).toEqual([]);
    const archived = await archive.query('SELECT id::text FROM audit_events_archive');
    expect(archived.rows).toEqual([{ id }]);
  });

  it('keeps the primary row when the archive holds something different under its id', async () => {
    const id = await insertEvent('2024-05-05T00:00:00Z', { original: true });
    await relocator.ensureArchiveSchema();
    await archive.query(
      `INSERT INTO audit_events_archive (id, action, target_type, target_id, outcome,
                                         correlation_id, summary, occurred_at)
       VALUES ($1, 'tampered', 'document', 'x', 'SUCCESS', $2, '{}', '2024-05-05T00:00:00Z')`,
      [id, randomUUID()],
    );

    await expect(relocator.relocate({ now: NOW })).rejects.toBeInstanceOf(
      AuditRelocationMismatchError,
    );
    expect(await primaryIds()).toEqual([id]);
  });
});

describe('audit_events refuses to be purged or edited (migration 0012)', () => {
  it('refuses UPDATE, even with the removal override set', async () => {
    const id = await insertEvent('2026-01-01T00:00:00Z');
    await expect(
      primary.query(`UPDATE audit_events SET action = 'edited' WHERE id = $1`, [id]),
    ).rejects.toThrow(/append-only/);
    const client = await primary.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL dts.allow_audit_removal = 'on'`);
      await expect(
        client.query(`UPDATE audit_events SET action = 'edited' WHERE id = $1`, [id]),
      ).rejects.toThrow(/append-only/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('refuses DELETE and TRUNCATE without the override', async () => {
    await insertEvent('2020-01-01T00:00:00Z');
    await expect(primary.query('DELETE FROM audit_events')).rejects.toThrow(/never purged/);
    await expect(primary.query('TRUNCATE audit_events')).rejects.toThrow(/never purged/);
    expect(await primaryIds()).toHaveLength(1);
  });

  it('refuses every removal from the archive, with no override at all', async () => {
    await insertEvent('2024-05-05T00:00:00Z');
    await relocator.relocate({ now: NOW });
    const client = await archive.connect();
    try {
      await client.query(`SET dts.allow_audit_removal = 'on'`);
      await expect(client.query('DELETE FROM audit_events_archive')).rejects.toThrow(/append-only/);
      await expect(client.query('TRUNCATE audit_events_archive')).rejects.toThrow(/append-only/);
      await expect(
        client.query(`UPDATE audit_events_archive SET action = 'edited'`),
      ).rejects.toThrow(/append-only/);
    } finally {
      await client.query('RESET dts.allow_audit_removal');
      client.release();
    }
  });
});
