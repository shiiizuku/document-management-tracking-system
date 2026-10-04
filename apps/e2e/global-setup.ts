import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FullConfig } from '@playwright/test';
import { assertLoginBudget } from './fixtures/accounts';
import { databaseUrl, ensureDatabase, resetSchema, seedOrganization } from './fixtures/database';
import { repositoryRoot as resolveRepositoryRoot } from './fixtures/paths';

/**
 * Builds the world the whole run shares: a dedicated database, the migrated schema, and the
 * organization tree and accounts from `fixtures/accounts.ts`.
 *
 * This runs once. Each spec file then truncates only the document side (`truncateDocuments`),
 * because the accounts must outlive it — see the note at the head of `fixtures/database.ts`.
 *
 * **It runs after the servers have started**, which Playwright does not let you change. That is
 * why the `webServer` entries wait on liveness rather than readiness: gating the API on a probe of
 * a database this function has not created yet is a deadlock. The consequence is that the API and
 * the worker are briefly up against a database with no schema — harmless, because both open
 * connections lazily per query, though the worker logs a missing-`outbox_events` error for a second
 * or two on the way through. No *test* runs until this has finished, which is the ordering the
 * suite actually depends on.
 */
/**
 * Refuses to go further without the artefacts `webServer` is about to run.
 *
 * Without this the run fails as three servers that never became ready and a 120-second wait each,
 * which says nothing about the cause. The suite deliberately does not build for you: a build is
 * minutes, and silently doing one would hide which commit is actually under test.
 */
const assertBuilt = (repositoryRoot: string): void => {
  const artefacts = [
    ['apps/api/dist/main.js', 'the API'],
    ['apps/api/dist/worker.js', 'the worker'],
    ['apps/web/.next/standalone/apps/web/server.js', 'the web app'],
  ] as const;
  const missing = artefacts.filter(([path]) => !existsSync(resolve(repositoryRoot, path)));
  if (missing.length > 0)
    throw new Error(
      `${missing.map(([, what]) => what).join(', ')} ${missing.length === 1 ? 'has' : 'have'} ` +
        'not been built. Run `npm run build` from the repository root first.',
    );
};

const applyMigrations = (repositoryRoot: string): void => {
  /*
   * Through npm rather than by importing the migrator: `apps/api` is a NodeNext package whose
   * migrator resolves `migrationsFolder: './drizzle'` relative to the working directory, and
   * `-w @dts/api` is what puts the working directory there. `shell: true` is for Windows, where
   * `npm` is a `.cmd` shim that cannot be executed directly.
   */
  execFileSync('npm', ['run', 'db:migrate', '-w', '@dts/api'], {
    cwd: repositoryRoot,
    shell: true,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: databaseUrl() },
  });
};

export default async function globalSetup(config: FullConfig): Promise<void> {
  assertLoginBudget();
  // From the config file's location, not `config.rootDir` — that is the test directory
  // (`apps/e2e/tests`), one level deeper than it looks. See `fixtures/paths.ts`.
  const repositoryRoot = resolveRepositoryRoot(config);

  assertBuilt(repositoryRoot);
  await ensureDatabase();
  await resetSchema();
  applyMigrations(repositoryRoot);
  await seedOrganization();
}
