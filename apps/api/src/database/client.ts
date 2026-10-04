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
  /**
   * Postgres JIT compilation. The scoped counts' cost estimates cross `jit_above_cost`, and on the
   * perf seed compiling took 235 ms of a 268 ms dashboard query that scanned in about 30 ms.
   * Unset leaves the server's setting alone.
   */
  jit?: boolean | undefined;
}

export const createDatabase = (
  connectionString = process.env.DATABASE_URL,
  { poolMax = 10, statementTimeoutMs, jit }: DatabaseOptions = {},
) => {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString,
    max: poolMax,
    idleTimeoutMillis: 30_000,
    // Past this a request is reported as busy (503, database-errors.ts), not as a failure.
    connectionTimeoutMillis: 5_000,
    ...(statementTimeoutMs === undefined ? {} : { statement_timeout: statementTimeoutMs }),
    ...(jit === undefined ? {} : { options: `-c jit=${jit ? 'on' : 'off'}` }),
  });
  return { pool, db: drizzle(pool, { schema }) };
};
export type DatabaseConnection = ReturnType<typeof createDatabase>;
export type Database = ReturnType<typeof createDatabase>['db'];
