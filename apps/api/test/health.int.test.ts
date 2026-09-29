import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/database/client.js';
import { HealthController } from '../src/modules/health/health.controller.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');

describe('readiness probe against a real database', () => {
  it('reports ready when PostgreSQL answers', async () => {
    const { pool, db } = createDatabase(databaseUrl);
    try {
      await expect(new HealthController(db).ready()).resolves.toEqual({
        status: 'ready',
        checks: { database: 'up' },
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
      await expect(new HealthController(db).ready()).rejects.toMatchObject({
        status: 503,
        response: { code: 'NOT_READY', details: { checks: { database: 'down' } } },
      });
    } finally {
      await pool.end();
    }
  });
});
