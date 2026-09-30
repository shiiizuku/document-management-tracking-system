import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/client.js';
import { HealthController } from '../src/modules/health/health.controller.js';
import { InMemoryStorageAdapter } from '../src/modules/files/storage.port.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');

// The object-store probe is exercised against the in-memory adapter here (a missing-key `get`
// resolves), so this suite stays focused on the real-database behaviour without needing MinIO.
const storage = new InMemoryStorageAdapter();

describe('readiness probe against a real database', () => {
  it('reports ready when PostgreSQL answers', async () => {
    const { pool, db } = createDatabase(databaseUrl);
    try {
      await expect(new HealthController(db, storage).ready()).resolves.toEqual({
        status: 'ready',
        checks: { database: 'up', storage: 'up' },
      });
    } finally {
      await pool.end();
    }
  });

  it('reports not-ready when PostgreSQL is unreachable', async () => {
    // A port nothing listens on stands in for a stopped database: the probe must fail
    // closed rather than reporting ready because it never got an answer.
    const unreachable = new URL(databaseUrl);
    unreachable.port = '1';
    const { pool, db } = createDatabase(unreachable.toString());
    try {
      await expect(new HealthController(db, storage).ready()).rejects.toMatchObject({
        status: 503,
        response: { code: 'NOT_READY', details: { checks: { database: 'down', storage: 'up' } } },
      });
    } finally {
      await pool.end();
    }
  });
});
