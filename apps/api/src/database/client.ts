import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

config({ path: new URL('../../../../.env', import.meta.url) });

export const createDatabase = (connectionString = process.env.DATABASE_URL) => {
  if (!connectionString) throw new Error('DATABASE_URL is required');
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
};
export type Database = ReturnType<typeof createDatabase>['db'];
