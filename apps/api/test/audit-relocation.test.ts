import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { relocationCutoff } from '../src/modules/audit/audit-relocation.js';

/**
 * P-08's "never purged", asserted over the source rather than over one code path.
 *
 * A purge is most likely to arrive as an innocent-looking cleanup — a `DELETE` in a maintenance
 * job, `audit_events` added to a TRUNCATE list. So this walks every place SQL can live in the
 * repository and fails on any statement that could remove audit rows outside the two sanctioned
 * places. Migration 0012 refuses the same statements at runtime; this catches them at review.
 */

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const SEARCHED = ['apps/api/src', 'apps/api/drizzle', 'apps/api/perf', 'apps/e2e', 'scripts'];
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  '.next',
  'playwright-report',
  'test-results',
]);

const sourceFiles = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) files.push(...(await sourceFiles(path)));
    } else if (/\.(ts|tsx|mjs|js|sql|sh)$/.test(entry.name)) files.push(path);
  }
  return files;
};

const repoPath = (path: string): string => relative(repositoryRoot, path).split(sep).join('/');

// Comment lines are dropped first: the files that explain the rule necessarily name the statements
// it forbids, and prose is not a purge.
const withoutComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !/^\s*(--|\/\/|\/?\*)/.test(line))
    .join('\n');

const filesMatching = async (pattern: RegExp): Promise<string[]> => {
  const matches: string[] = [];
  for (const root of SEARCHED)
    for (const file of await sourceFiles(join(repositoryRoot, root)))
      if (pattern.test(withoutComments(await readFile(file, 'utf8')))) matches.push(repoPath(file));
  return matches.sort();
};

describe('audit retention (P-08): no purge path', () => {
  it('sets the audit-removal override in exactly the relocator and the E2E reset', async () => {
    // The migration that defines the override names it too, and is not a place that sets it.
    const setters = (await filesMatching(/allow_audit_removal\s*=\s*'on'/)).filter(
      (file) => !file.startsWith('apps/api/drizzle/'),
    );
    expect(setters).toEqual([
      'apps/api/src/modules/audit/audit-relocation.ts',
      'apps/e2e/fixtures/database.ts',
    ]);
  });

  it('removes audit rows only in the relocator', async () => {
    const deleters = await filesMatching(
      /delete\s*\(\s*auditEvents\s*\)|delete\s+from\s+"?audit_events"?\b/i,
    );
    expect(deleters).toEqual(['apps/api/src/modules/audit/audit-relocation.ts']);
  });

  it('truncates audit_events only in the disposable E2E reset', async () => {
    // `BEFORE TRUNCATE ON audit_events` is migration 0012's guard, not a truncation.
    const truncaters = await filesMatching(
      /(?<!before\s+)\btruncate\s+(?!on\b)[^;`]*\baudit_events\b/i,
    );
    expect(truncaters).toEqual(['apps/e2e/fixtures/database.ts']);
  });

  it('never edits an audit row', async () => {
    const updaters = await filesMatching(
      /update\s*\(\s*auditEvents\s*\)|update\s+"?audit_events"?\s+set\b/i,
    );
    expect(updaters).toEqual([]);
  });

  it('relocates nothing younger than five years', () => {
    expect(relocationCutoff(new Date('2031-06-15T08:00:00.000Z')).toISOString()).toBe(
      '2026-06-15T08:00:00.000Z',
    );
    // A leap day has no anniversary; the cutoff rolls forward rather than back, so a row is never
    // relocated a day early.
    expect(relocationCutoff(new Date('2032-02-29T00:00:00.000Z')).toISOString()).toBe(
      '2027-03-01T00:00:00.000Z',
    );
  });
});
