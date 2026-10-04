import { drizzle } from 'drizzle-orm/node-postgres';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { ACCOUNTS, DIVISIONS, SECTIONS } from '../../e2e/fixtures/accounts.js';
import * as schema from '../src/database/schema.js';
import { DrizzleAuditWriter } from '../src/modules/audit/audit.writer.js';
import type { AuthorizationActor } from '../src/modules/authorization/authorization.policy.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import { NotificationsRepository } from '../src/modules/notifications/notifications.repository.js';
import { perfDatabaseUrl } from './database.js';

/**
 * D1's `EXPLAIN` pass: every critical read, planned against the pilot-sized database.
 *
 * **The SQL is not written here.** Each query is produced by calling the real repository method
 * against a Drizzle instance whose logger captures what it sends, and the captured text and
 * parameters are what get explained. A hand-copied query would drift from the repository the first
 * time someone touched `query-scope.ts`, and the plans would then be evidence about a query nobody
 * runs.
 *
 * Every query is planned with `EXPLAIN (ANALYZE, BUFFERS)` through the same unnamed-statement path
 * node-postgres uses in the application, so Postgres sees real parameter values and builds the
 * custom plan production gets. Each is run `RUNS` times and the median execution time reported, so
 * a cold buffer cache on the first run does not decide the verdict.
 *
 * Writes `docs/evidence/d1-explain-plans.md`. Run `perf/pilot-seed.ts` first.
 */

const RUNS = 5;
// A query slower than this is not repeated: its verdict does not depend on cache warmth, and five
// runs of a 90-second plan would make the pass take most of an hour.
const REPEAT_BELOW_MS = 2_000;
const OUTPUT = new URL(
  process.env.EXPLAIN_OUTPUT ?? '../../../docs/evidence/d1-explain-plans.md',
  import.meta.url,
);
/*
 * A ceiling per statement. Before migration 0011 the custody filters ran for minutes; a pass that
 * waited them out took over an hour and said nothing a timeout does not. A statement that hits it
 * is recorded as "> N s" with its estimated plan instead.
 */
const TIMEOUT_MS = Number(process.env.EXPLAIN_TIMEOUT_MS ?? 60_000);

interface Captured {
  sql: string;
  params: unknown[];
}

const actor = (account: (typeof ACCOUNTS)[keyof typeof ACCOUNTS]): AuthorizationActor => ({
  id: account.id,
  role: account.role,
  divisionId: account.divisionId,
  sectionId: account.sectionId,
  capabilities: [],
  canAccessConfidential: account.canAccessConfidential,
});

const ACTORS = {
  records: actor(ACCOUNTS.records),
  head: actor(ACCOUNTS.head),
  staff: actor(ACCOUNTS.staff),
} as const;

interface Scenario {
  name: string;
  /** Which screen or job issues it, so a slow plan can be traced to what a user would notice. */
  caller: string;
  run: () => Promise<unknown>;
}

const pool = new Pool({
  connectionString: perfDatabaseUrl(),
  max: 2,
  options: `-c statement_timeout=${TIMEOUT_MS}`,
});
// `57014` is query_canceled. Drizzle wraps driver errors, so the code may sit on `cause`.
const isTimeout = (error: unknown): boolean => {
  const failure = error as { code?: string; cause?: { code?: string } } | null;
  return failure?.code === '57014' || failure?.cause?.code === '57014';
};
let capturing: Captured[] | null = null;
const db = drizzle(pool, {
  schema,
  logger: {
    logQuery: (sql, params) => {
      capturing?.push({ sql, params });
    },
  },
});

const documents = new DocumentsRepository(db);
const audit = new DrizzleAuditWriter(db);
const notifications = new NotificationsRepository(db);

const sampleIds = async () => {
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM documents
     WHERE section_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [SECTIONS.general.id],
  );
  if (!rows[0]) throw new Error('No sample document — run perf/pilot-seed.ts first');
  return { generalDocumentId: rows[0].id };
};

const scenarios = (ids: { generalDocumentId: string }): Scenario[] => {
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  return [
    // ---------------------------------------------------------------- registry
    ...(['records', 'head', 'staff'] as const).map((who) => ({
      name: `registry, first page — ${who}`,
      caller: 'GET /documents (registry landing)',
      run: () => documents.search(ACTORS[who], {}),
    })),
    ...(['records', 'head', 'staff'] as const).map((who) => ({
      name: `registry, Pending filter — ${who}`,
      caller: 'GET /documents?status=PENDING',
      run: () => documents.search(ACTORS[who], { status: 'PENDING' }),
    })),
    {
      name: 'registry, text search "permit" — records',
      caller: 'GET /documents?search=',
      run: () => documents.search(ACTORS.records, { search: 'permit' }),
    },
    {
      name: 'registry, text search "permit" — staff',
      caller: 'GET /documents?search=',
      run: () => documents.search(ACTORS.staff, { search: 'permit' }),
    },
    {
      name: 'registry, tracking-number lookup — records',
      caller: 'GET /documents?search= (a tracking number pasted in)',
      run: () => documents.search(ACTORS.records, { search: 'DTS-2026-059990' }),
    },
    {
      name: 'registry, custody division filter — records',
      caller: 'GET /documents?divisionId= (dashboard chart click-through)',
      run: () => documents.search(ACTORS.records, { divisionId: DIVISIONS.pilot.id }),
    },
    {
      name: 'registry, custody section filter — records',
      caller: 'GET /documents?sectionId=',
      run: () => documents.search(ACTORS.records, { sectionId: SECTIONS.general.id }),
    },
    {
      name: 'registry, page 50 by priority — records',
      caller: 'GET /documents?sort=priority&page=50',
      run: () => documents.search(ACTORS.records, { sort: 'priority', page: 50 }),
    },
    // ---------------------------------------------------------------- detail
    {
      name: 'document detail, scoped read — staff',
      caller: 'GET /documents/:id',
      run: () => documents.findReadableById(ACTORS.staff, ids.generalDocumentId),
    },
    {
      name: 'document timeline',
      caller: 'GET /documents/:id (timeline)',
      run: () => documents.listTimeline(ids.generalDocumentId),
    },
    {
      name: 'document routes',
      caller: 'GET /documents/:id (routing slip)',
      run: () => documents.listRoutes(ids.generalDocumentId),
    },
    // ---------------------------------------------------------------- dashboard
    ...(['records', 'head', 'staff'] as const).map((who) => ({
      name: `dashboard summary — ${who}`,
      caller: 'GET /dashboard (tiles)',
      run: () => documents.summary(ACTORS[who]),
    })),
    ...(['records', 'head'] as const).map((who) => ({
      name: `dashboard pending by division — ${who}`,
      caller: 'GET /dashboard (division chart)',
      run: () => documents.pendingByDivision(ACTORS[who]),
    })),
    ...(['records', 'staff'] as const).map((who) => ({
      name: `dashboard recent activity — ${who}`,
      caller: 'GET /dashboard (activity feed)',
      run: () => documents.recentActivity(ACTORS[who], 10),
    })),
    // ---------------------------------------------------------------- work queues and reports
    {
      name: 'my work — staff',
      caller: 'GET /my-work',
      run: () => documents.listAssignedTo(ACCOUNTS.staff.id),
    },
    {
      name: 'deleted documents — records',
      caller: 'GET /documents/deleted',
      run: () => documents.listDeleted(ACTORS.records),
    },
    {
      name: 'monthly report, current month — records',
      caller: 'GET /reports/monthly',
      run: () =>
        documents.listForReport(ACTORS.records, now.getUTCFullYear(), now.getUTCMonth() + 1),
    },
    // ---------------------------------------------------------------- audit
    {
      name: 'audit log, unfiltered first page',
      caller: 'GET /audit',
      run: () => audit.list({}),
    },
    {
      name: 'audit log, by actor',
      caller: 'GET /audit?actorId=',
      run: () => audit.list({ actorId: ACCOUNTS.records.id }),
    },
    {
      name: 'audit log, by action over 30 days',
      caller: 'GET /audit?action=&from=&to=',
      run: () => audit.list({ action: 'auth.login', from: monthAgo, to: now }),
    },
    {
      name: 'audit log, date range only',
      caller: 'GET /audit?from=&to=',
      run: () => audit.list({ from: monthAgo, to: now }),
    },
    // ---------------------------------------------------------------- notifications
    {
      name: 'notifications, first page — head',
      caller: 'GET /notifications',
      run: () => notifications.list(ACCOUNTS.head.id),
    },
    {
      name: 'notifications, unread count — head',
      caller: 'GET /notifications/unread-count (polled by the shell)',
      run: () => notifications.unreadCount(ACCOUNTS.head.id),
    },
  ];
};

/** The outbox relay's lease query, which is raw SQL in `outbox-relay.ts` rather than a repository call. */
const OUTBOX_DRAIN: Captured = {
  sql: `select id, aggregate_type, aggregate_id, event_type, payload, idempotency_key
        from outbox_events where published_at is null order by created_at limit $1
        for update skip locked`,
  params: [50],
};

interface PlanResult {
  sql: string;
  params: unknown[];
  medianMs: number;
  plan: string;
  seqScans: string[];
}

const formatMs = (ms: number): string =>
  Number.isFinite(ms) ? `${ms.toFixed(2)} ms` : `> ${(TIMEOUT_MS / 1000).toFixed(0)} s`;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

const explain = async (query: Captured): Promise<PlanResult> => {
  const timings: number[] = [];
  let plan = '';
  for (let i = 0; i < RUNS; i++) {
    try {
      const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${query.sql}`,
        query.params,
      );
      plan = rows.map((row) => row['QUERY PLAN']).join('\n');
    } catch (error) {
      if (!isTimeout(error)) throw error;
      const { rows } = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN ${query.sql}`,
        query.params,
      );
      const estimated = rows.map((row) => row['QUERY PLAN']).join('\n');
      plan = `-- Timed out after ${TIMEOUT_MS / 1000} s; estimated plan only.\n${estimated}`;
      timings.push(Number.POSITIVE_INFINITY);
      break;
    }
    const match = /Execution Time: ([\d.]+) ms/.exec(plan);
    timings.push(match ? Number(match[1]) : Number.NaN);
    if (timings[0]! > REPEAT_BELOW_MS) break;
  }
  // Sequential scans of the large tables are the thing to look at first; the small lookup tables
  // are cheaper to scan than to index, and Postgres is right to scan them.
  const seqScans = [
    ...plan.matchAll(
      /Seq Scan on (documents|document_routes|workflow_events|audit_events|notifications|outbox_events|document_assignments|file_versions)\b[^\n]*rows=(\d+)[^\n]*\n?/g,
    ),
  ].map((m) => `${m[1]}`);
  return { ...query, medianMs: median(timings), plan, seqScans: [...new Set(seqScans)] };
};

const renderParams = (params: unknown[]): string =>
  params.length === 0
    ? ''
    : `\n\nParameters: ${params
        .map((p, i) => `$${i + 1} = ${p instanceof Date ? p.toISOString() : JSON.stringify(p)}`)
        .join(', ')}`;

const main = async (): Promise<void> => {
  const ids = await sampleIds();
  const { rows: sizeRows } = await pool.query<{ relname: string; rows: string }>(
    `SELECT relname, reltuples::bigint::text AS rows FROM pg_class
     WHERE relname IN ('documents', 'document_routes', 'workflow_events', 'audit_events',
                       'notifications')
     ORDER BY reltuples DESC`,
  );
  const { rows: versionRows } = await pool.query<{ version: string }>('SHOW server_version');

  const results: { scenario: Scenario; plans: PlanResult[] }[] = [];
  for (const scenario of scenarios(ids)) {
    capturing = [];
    await scenario.run().catch((error: unknown) => {
      // The statement was captured before it ran, which is all this pass needs from the call.
      if (!isTimeout(error)) throw error;
    });
    const captured = capturing;
    capturing = null;
    const plans: PlanResult[] = [];
    for (const query of captured) plans.push(await explain(query));
    results.push({ scenario, plans });
    process.stdout.write(
      `${scenario.name.padEnd(52)} ${plans.map((p) => formatMs(p.medianMs)).join(' + ')}\n`,
    );
  }
  const outbox = await explain(OUTBOX_DRAIN);
  results.push({
    scenario: {
      name: 'outbox relay lease',
      caller: 'worker, every poll',
      run: () => Promise.resolve(null),
    },
    plans: [outbox],
  });
  process.stdout.write(`${'outbox relay lease'.padEnd(52)} ${formatMs(outbox.medianMs)}\n`);

  const lines: string[] = [
    '# D1 — EXPLAIN plans against pilot-sized data',
    '',
    `_Generated by \`apps/api/perf/explain.ts\` on ${new Date().toISOString().slice(0, 10)}, PostgreSQL ${versionRows[0]?.version}. Do not edit by hand — rerun the script. The verdicts and the reasoning behind them are in \`d1-query-plans.md\`._`,
    '',
    'Table sizes: ' +
      sizeRows.map((r) => `\`${r.relname}\` ${Number(r.rows).toLocaleString()}`).join(', ') +
      '.',
    '',
    `Each query ran ${RUNS} times (once, if the first run exceeded ${REPEAT_BELOW_MS / 1000} s); the time is the median of Postgres's own \`Execution Time\`, so it excludes the network and the driver.`,
    '',
    '| Scenario | Caller | Statements (median ms) | Large-table seq scans |',
    '| --- | --- | --- | --- |',
    ...results.map(
      ({ scenario, plans }) =>
        `| ${scenario.name} | ${scenario.caller} | ${plans.map((p) => formatMs(p.medianMs)).join(' + ')} | ${[...new Set(plans.flatMap((p) => p.seqScans))].join(', ') || '—'} |`,
    ),
    '',
  ];
  for (const { scenario, plans } of results) {
    lines.push(`## ${scenario.name}`, '', `Caller: ${scenario.caller}`, '');
    plans.forEach((plan, i) => {
      if (plans.length > 1)
        lines.push(`### Statement ${i + 1} — ${formatMs(plan.medianMs)} ms`, '');
      else lines.push(`Median execution: ${formatMs(plan.medianMs)} ms`, '');
      lines.push(
        '```sql',
        plan.sql.trim(),
        '```' + renderParams(plan.params),
        '',
        '```text',
        plan.plan,
        '```',
        '',
      );
    });
  }
  await writeFile(OUTPUT, lines.join('\n'), 'utf8');
  process.stdout.write(`\nWrote ${OUTPUT.pathname}\n`);
};

try {
  await main();
} finally {
  await pool.end();
}
