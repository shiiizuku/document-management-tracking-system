import { hash } from 'bcryptjs';
import { Client } from 'pg';
import { ACCOUNTS, DIVISIONS, SECTIONS, type SeededAccount } from './accounts';
import { DEFAULT_DATABASE_URL } from './environment';

/**
 * The end-to-end suite's database: a dedicated one, created on first run, reset once per run and
 * truncated once per spec file.
 *
 * **Why a database of its own.** Seeding drops and recreates `public`. Pointed at the database a
 * developer runs `npm run dev` against, that is their afternoon gone — so the name is separate by
 * default, the destructive calls demand `ALLOW_DATABASE_RESET=true` exactly as the integration
 * suites do, and `assertSafeTarget` refuses a name that does not look disposable.
 *
 * **Why truncation and not a snapshot.** C2 of `docs/phase-7-sequencing.md` asked for a decision
 * between per-test truncation and a seeded snapshot restored per spec. Truncation wins, and only
 * of the document side:
 *
 * - The accounts must survive. A session is a stateless JWT keyed on the user's id (ADR-0002), so
 *   reseeding users invalidates every saved `storageState` and forces a fresh login per spec —
 *   which `POST /auth/login`'s five-a-minute throttle refuses almost immediately.
 * - A snapshot restore cannot be done per spec anyway: `CREATE DATABASE … TEMPLATE` needs no other
 *   session connected to the template, and the API process holds a pool open against a fixed
 *   database name for the whole run.
 *
 * So the organization tree and the accounts are fixtures of the *run*, and everything a spec
 * creates is a fixture of the *spec*.
 */

export const databaseUrl = (): string => process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;

/** The database name in a connection URL (`/dts_e2e` → `dts_e2e`). */
const databaseName = (url: string): string => new URL(url).pathname.replace(/^\//, '');

/**
 * Refuses to point a destructive operation at anything that does not look like a throwaway.
 *
 * Two independent conditions, because either alone is too easy to satisfy by accident: the opt-in
 * environment variable the integration suites already use, and a name that says what it is for.
 */
const assertSafeTarget = (url: string): void => {
  if (process.env.ALLOW_DATABASE_RESET !== 'true')
    throw new Error(
      'ALLOW_DATABASE_RESET=true is required: the end-to-end seed drops and recreates the ' +
        'public schema.',
    );
  const name = databaseName(url);
  if (!/e2e|test/i.test(name))
    throw new Error(
      `Refusing to reset "${name}": the end-to-end database name must contain "e2e" or "test", ` +
        'so a development database cannot be wiped by a mistyped DATABASE_URL.',
    );
};

const withClient = async <T>(url: string, work: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

/**
 * Creates the end-to-end database if it is not there yet.
 *
 * `docker-compose.yml` creates exactly one database (`POSTGRES_DB`), so the dedicated one has to
 * be made here. It is done from the `postgres` maintenance database because `CREATE DATABASE`
 * cannot run from inside the database it creates — and it is checked first rather than wrapped in
 * a try/catch, because "already exists" and "you may not do that" are different answers.
 */
export const ensureDatabase = async (): Promise<void> => {
  const url = databaseUrl();
  assertSafeTarget(url);
  const name = databaseName(url);
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';

  await withClient(maintenance.toString(), async (client) => {
    const existing = await client.query<{ one: number }>(
      'SELECT 1 AS one FROM pg_database WHERE datname = $1',
      [name],
    );
    if (existing.rowCount === 0) {
      // Identifiers cannot be parameterised. `assertSafeTarget` has already constrained the name,
      // and the quoting is what makes anything it let through inert.
      await client.query(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    }
  });
};

/** Drops every migration and every table, so the run starts from the schema the migrator builds. */
export const resetSchema = async (): Promise<void> => {
  const url = databaseUrl();
  assertSafeTarget(url);
  await withClient(url, async (client) => {
    await client.query(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
    );
  });
};

/*
 * Plain inserts, with no `ON CONFLICT`. `seedOrganization` runs immediately after `resetSchema`,
 * so a conflict means something other than this function has written to the tree — which should
 * stop the run rather than be absorbed into an upsert that quietly leaves a row holding an id
 * other than the one `accounts.ts` promises every spec.
 */
const insertDivision = async (
  client: Client,
  division: { id: string; code: string; name: string },
): Promise<void> => {
  await client.query('INSERT INTO divisions (id, code, name, active) VALUES ($1, $2, $3, true)', [
    division.id,
    division.code,
    division.name,
  ]);
};

const insertSection = async (
  client: Client,
  section: { id: string; divisionId: string; code: string; name: string },
): Promise<void> => {
  await client.query(
    'INSERT INTO sections (id, division_id, code, name, active) VALUES ($1, $2, $3, $4, true)',
    [section.id, section.divisionId, section.code, section.name],
  );
};

const insertAccount = async (client: Client, account: SeededAccount): Promise<void> => {
  // Cost 12, the same as the application's own hashing, so a login in the suite costs what a
  // login costs in the pilot. Six of them is about a second, once per run.
  const passwordHash = await hash(account.password, 12);
  await client.query(
    `INSERT INTO users
       (id, email, display_name, password_hash, role, division_id, section_id,
        can_access_confidential, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
    [
      account.id,
      account.email,
      account.displayName,
      passwordHash,
      account.role,
      account.divisionId,
      account.sectionId,
      account.canAccessConfidential,
    ],
  );
};

/**
 * Plants the organization and the accounts.
 *
 * Raw SQL rather than the API's Drizzle schema: importing it would mean resolving an entire
 * NodeNext package from inside Playwright's transpiler, to write eleven rows. The column names are
 * asserted by the run itself — a renamed column fails every spec at setup, loudly.
 */
export const seedOrganization = async (): Promise<void> => {
  await withClient(databaseUrl(), async (client) => {
    for (const division of Object.values(DIVISIONS)) await insertDivision(client, division);
    for (const section of Object.values(SECTIONS)) await insertSection(client, section);
    for (const account of Object.values(ACCOUNTS)) await insertAccount(client, account);
  });
};

/**
 * The per-spec reset: everything a spec can create, and nothing a spec depends on.
 *
 * `documents` carries the whole document side behind foreign keys, so `CASCADE` reaches the
 * routes, workflow events, attachments, signatures, releases and notifications without this list
 * having to track them. The counters are included so tracking and reference numbers restart at 1
 * and a spec may assert `DTS-<year>-000001` instead of scanning for whatever it got.
 *
 * Objects already written to the bucket are left behind. They are unreferenced after this and
 * nothing reads them; the end-to-end bucket is disposable, and reconciling object storage with a
 * truncated database would be a second, slower copy of the restore runbook.
 */
export const truncateDocuments = async (): Promise<void> => {
  assertSafeTarget(databaseUrl());
  await withClient(databaseUrl(), async (client) => {
    /*
     * `audit_events` refuses TRUNCATE unless `dts.allow_audit_removal` is set (migration 0012,
     * policy P-08). This reset is one of the two places allowed to set it — the database is
     * disposable by construction — and `audit-relocation.test.ts` fails if a third appears.
     * `SET LOCAL` keeps the override inside this one transaction.
     */
    await client.query('BEGIN');
    await client.query(`SET LOCAL dts.allow_audit_removal = 'on'`);
    await client.query(
      `TRUNCATE TABLE documents, notifications, audit_events, outbox_events,
         reference_counters, document_sequences RESTART IDENTITY CASCADE`,
    );
    await client.query('COMMIT');
  });
};

/** One scalar read, for assertions that are cheaper to make against the database than the UI. */
export const queryOne = async <T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> =>
  withClient(databaseUrl(), async (client) => {
    const result = await client.query<T>(text, [...values]);
    return result.rows[0] ?? null;
  });
