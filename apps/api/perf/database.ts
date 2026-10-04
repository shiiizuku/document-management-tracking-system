import { config } from 'dotenv';
import { Client } from 'pg';

config({ path: new URL('../../../.env', import.meta.url) });

/**
 * The performance toolkit's database: a dedicated one, never the database `npm run dev` uses.
 *
 * The pilot seed drops and recreates `public`, so it is guarded the same two ways the end-to-end
 * suite's reset is (`apps/e2e/fixtures/database.ts`): an explicit opt-in, and a database name that
 * says it is disposable. The name check is narrower here — `perf` only — so neither suite can be
 * pointed at the other's database by reusing its variable.
 */
export const DEFAULT_PERF_DATABASE_URL = 'postgresql://dts:dts@localhost:5433/dts_perf';

export const perfDatabaseUrl = (): string =>
  process.env.PERF_DATABASE_URL ?? DEFAULT_PERF_DATABASE_URL;

const databaseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');

export const assertSafeTarget = (url: string): void => {
  if (process.env.ALLOW_DATABASE_RESET !== 'true')
    throw new Error(
      'ALLOW_DATABASE_RESET=true is required: the pilot seed drops and recreates the public schema.',
    );
  const name = databaseName(url);
  if (!/perf/i.test(name))
    throw new Error(
      `Refusing to reset "${name}": the performance database name must contain "perf", so a ` +
        'development or end-to-end database cannot be wiped by a mistyped PERF_DATABASE_URL.',
    );
};

export const withClient = async <T>(
  url: string,
  work: (client: Client) => Promise<T>,
): Promise<T> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

/** Creates the database from the `postgres` maintenance database if it does not exist yet. */
export const ensureDatabase = async (url: string): Promise<void> => {
  const name = databaseName(url);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  await withClient(maintenance.toString(), async (client) => {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0)
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
  });
};
