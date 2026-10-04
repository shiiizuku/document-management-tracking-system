import { config } from 'dotenv';
import { Pool } from 'pg';
import { AuditRelocator, relocationCutoff } from '../modules/audit/audit-relocation.js';

config({ path: new URL('../../../../.env', import.meta.url) });

/*
 * `npm run audit:relocate -w @dts/api` — moves audit events older than five years from the primary
 * database to the archive named by `AUDIT_ARCHIVE_DATABASE_URL` (policy P-08). Safe to rerun, and
 * safe to interrupt: see `AuditRelocator` for why no row can be lost either way. The procedure is
 * written down in `docs/runbooks/audit-relocation.md`.
 *
 * Refuses to start without both URLs, and refuses an archive URL that names the primary database:
 * "relocating" rows into the table they came from would delete them.
 */
const primaryUrl = process.env.DATABASE_URL;
const archiveUrl = process.env.AUDIT_ARCHIVE_DATABASE_URL;
if (!primaryUrl) throw new Error('DATABASE_URL is required');
if (!archiveUrl)
  throw new Error(
    'AUDIT_ARCHIVE_DATABASE_URL is required: it names the separate database P-08 relocates audit ' +
      'events into, which IT operations provides.',
  );
const sameDatabase = (a: string, b: string): boolean => {
  const [x, y] = [new URL(a), new URL(b)];
  return x.host === y.host && x.pathname === y.pathname;
};
if (sameDatabase(primaryUrl, archiveUrl))
  throw new Error('AUDIT_ARCHIVE_DATABASE_URL must name a different database from DATABASE_URL');

const primary = new Pool({ connectionString: primaryUrl, max: 2 });
const archive = new Pool({ connectionString: archiveUrl, max: 2 });
try {
  process.stdout.write(
    `Relocating audit events written before ${relocationCutoff(new Date()).toISOString()}\n`,
  );
  const result = await new AuditRelocator(primary, archive).relocate();
  process.stdout.write(`Relocated ${result.relocated} event(s) in ${result.batches} batch(es).\n`);
} finally {
  await Promise.all([primary.end(), archive.end()]);
}
