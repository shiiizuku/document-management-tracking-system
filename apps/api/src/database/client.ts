import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export interface DatabaseOptions {
  /** Pool size. Match it to the database host's cores: a CPU-bound Postgres gains nothing from more. */
  poolMax?: number | undefined;
  /**
   * Server-side cap on one statement, so a runaway scan cannot hold a connection indefinitely.
   * Unset means none, which is what migrations and the seed want.
   */
  statementTimeoutMs?: number | undefined;
}

export const createDatabase = (
  connectionString = process.env.DATABASE_URL,
  { poolMax = 10, statementTimeoutMs }: DatabaseOptions = {},
) => {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    // Past this a request is reported as busy (503, database-errors.ts), not as a failure.
    connectionTimeoutMillis: 5_000,
    ...(statementTimeoutMs === undefined ? {} : { statement_timeout: statementTimeoutMs }),
  });
  return { pool, db: drizzle(pool, { schema }) };
};
export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = ReturnType<typeof createDatabase>['db'];
