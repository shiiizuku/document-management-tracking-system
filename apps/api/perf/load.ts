import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { ACCOUNTS, DIVISIONS, SECTIONS } from '../../e2e/fixtures/accounts.js';
import { perfDatabaseUrl, reportUrl } from './database.js';
import { HttpError, Session, type Sample } from './load-client.js';
import { Journey, ScanPending, type JourneyContext, type Principals } from './load-journeys.js';
import { generatedAccounts, LOAD_ACCOUNT_PASSWORD } from './organization.js';

/**
 * D2 of `docs/phase-7-sequencing.md`: search, upload and workflow load over D1's pilot-sized data,
 * measured against a stated target.
 *
 * ## The target, and where its numbers come from
 *
 * Nothing in the decision register states a serving target — P-13's numbers are about recovery —
 * so the demand is estimated here, where it can be corrected, the same way D1 wrote down its volume:
 *
 * - **158 accounts** (D1's organization), and in the busiest hour **every one of them active**,
 *   each performing one action — a search, opening a document, a workflow step — **every 30
 *   seconds**. That is about **5.3 actions a second**, which is generous: it is a whole office
 *   working flat out at once.
 * - The target is **three times that, 15 actions a second, held for ten minutes**, with:
 *   reads p95 ≤ 500 ms, workflow writes p95 ≤ 1 s, a 512 KiB upload p95 ≤ 2 s, under 0.5 % of
 *   requests failing and **no 5xx at all**.
 *
 * Then the arrival rate is stepped through 5, 10, 20 and 30 actions a second to find where it
 * stops holding, so the report says how much headroom the target leaves, not only that it passed.
 *
 * ## How it measures
 *
 * **Open model.** Actions arrive on a Poisson schedule at the stated rate whether or not earlier
 * ones have finished, the way an office's users do. A closed loop of virtual users waiting for each
 * response would slow its own arrivals as the server slowed, and hide exactly the queueing a load
 * test exists to show.
 *
 * **The production build, in production mode**, started here against `dts_perf` with its worker
 * (so uploads are scanned by real ClamAV while the load runs), its own Redis database index and
 * `TRUST_PROXY=loopback` — see `load-client.ts` for why each session speaks through its own
 * forwarded address. The generator runs on the same machine, so its event-loop delay is reported
 * beside the results: a number measured by a saturated generator is not a number about the server.
 *
 * **It writes.** Every journey registers real documents into `dts_perf`. Reseed (`perf:seed`)
 * before a run whose numbers will be compared with another's.
 *
 * Writes `docs/evidence/d2-load-run.md`.
 */

const number = (name: string, fallback: number): number => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
};

const TARGET_OPS = number('LOAD_TARGET_OPS', 15);
const WARMUP_S = number('LOAD_WARMUP_S', 60);
const STEADY_S = number('LOAD_STEADY_S', 600);
const STEP_S = number('LOAD_STEP_S', 120);
const STEPS = (process.env.LOAD_STEPS ?? '5,10,20,30')
  .split(',')
  .filter((step) => step.trim() !== '')
  .map(Number);
const UPLOAD_BYTES = number('LOAD_UPLOAD_BYTES', 512 * 1024);
const API_PORT = number('LOAD_API_PORT', 4101);
const WORKER_HEALTH_PORT = number('LOAD_WORKER_HEALTH_PORT', 4102);
// Concurrently open journeys. Enough that consecutive steps of one journey are seconds apart.
const MAX_JOURNEYS = number('LOAD_MAX_JOURNEYS', 40);
// Past this, the server is not keeping up and further arrivals are counted as dropped.
const MAX_IN_FLIGHT = number('LOAD_MAX_IN_FLIGHT', 2_000);
const OUTPUT = reportUrl(
  process.env.LOAD_OUTPUT ?? '../../../docs/evidence/d2-load-run.md',
  import.meta.url,
);

const TARGET = { readP95: 500, writeP95: 1_000, uploadP95: 2_000, errorRate: 0.005 } as const;

// The share of arrivals each kind of action takes. Reads dominate, as they do in a registry.
const MIX = [
  ['search', 0.3],
  ['registry', 0.2],
  ['open', 0.25],
  ['dashboard', 0.1],
  ['upload', 0.05],
  ['workflow', 0.1],
] as const;
type Operation = (typeof MIX)[number][0];

// Terms a user would type, drawn from the seed's vocabulary so that they match something.
const SEARCH_TERMS = [
  'permit',
  'survey',
  'safety report',
  'Correspondent 4',
  'Agusan',
  'audit findings',
  'travel authority',
  'DTS-2025',
  'MMD-2024',
  'Northern Mining',
  'geohazard',
  'procurement',
];

// ---------------------------------------------------------------------------- randomness

/** Seeded, so two runs offer the same sequence of actions. */
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
};
const random = mulberry32(20261004);
const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
const chooseOperation = (): Operation => {
  let roll = random();
  for (const [operation, share] of MIX) if ((roll -= share) < 0) return operation;
  return 'search';
};

/**
 * A PDF the upload gate accepts, padded to the size under test with an inert comment block.
 * Each upload differs in its first line, so no two share a checksum.
 */
const pdf = (salt: string): Buffer => {
  const head = Buffer.from(`%PDF-1.7\n%${salt}\n1 0 obj<<>>endobj\n`);
  const tail = Buffer.from('trailer<<>>\n%%EOF\n');
  const padding = Math.max(0, UPLOAD_BYTES - head.length - tail.length);
  const line = '% padding to the size of a scanned page, ignored by every reader\n';
  return Buffer.concat([
    head,
    Buffer.from(line.repeat(Math.ceil(padding / line.length))).subarray(0, padding),
    tail,
  ]);
};

// ---------------------------------------------------------------------------- recording

let phase = 'sign-in';
const samples = new Map<string, Sample[]>();
const notes = new Map<string, Map<string, number>>();
const failures = new Map<string, number>();

const record = (sample: Sample): void => {
  const list = samples.get(phase) ?? [];
  list.push(sample);
  samples.set(phase, list);
};
const note = (event: string): void => {
  const phaseNotes = notes.get(phase) ?? new Map<string, number>();
  phaseNotes.set(event, (phaseNotes.get(event) ?? 0) + 1);
  notes.set(phase, phaseNotes);
};
const fail = (error: unknown): void => {
  const message =
    error instanceof HttpError
      ? // The correlation id differs on every response and would split one failure into many.
        `${error.label} → ${error.status} ${error.body.replace(/"correlationId":"[^"]*"/, '"correlationId":…').slice(0, 160)}`
      : String(error instanceof Error ? error.message : error).slice(0, 200);
  failures.set(message, (failures.get(message) ?? 0) + 1);
};

// ---------------------------------------------------------------------------- the servers

const API_DIR = fileURLToPath(new URL('..', import.meta.url));
const children: ChildProcess[] = [];

const serverEnvironment = (): NodeJS.ProcessEnv => {
  const redis = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  // Its own queue: a worker left running against another database would steal the scan jobs.
  redis.pathname = '/3';
  return {
    ...process.env,
    NODE_ENV: 'production',
    LOG_LEVEL: 'warn',
    DATABASE_URL: perfDatabaseUrl(),
    REDIS_URL: redis.toString(),
    PORT: String(API_PORT),
    WORKER_HEALTH_PORT: String(WORKER_HEALTH_PORT),
    TRUST_PROXY: 'loopback',
    // Production refuses insecure cookies; the generator's jar ignores the flag.
    COOKIE_SECURE: 'true',
    DIRECTOR_EMAIL: ACCOUNTS.director.email,
    DIRECTOR_PASSWORD: ACCOUNTS.director.password,
  };
};

const startServers = async (): Promise<void> => {
  for (const script of ['dist/main.js', 'dist/worker.js']) {
    const child = spawn(process.execPath, [script], {
      cwd: API_DIR,
      env: serverEnvironment(),
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr?.on('data', (chunk: Buffer) =>
      process.stderr.write(`[${script}] ${chunk.toString()}`),
    );
    child.on('exit', (code) => {
      if (code !== null && code !== 0 && !stopping)
        process.stderr.write(`${script} exited with ${code}\n`);
    });
    children.push(child);
  }
  const deadline = Date.now() + 60_000;
  for (const url of [
    `http://localhost:${API_PORT}/api/v1/health/ready`,
    `http://localhost:${WORKER_HEALTH_PORT}/health`,
  ])
    for (;;) {
      try {
        if ((await fetch(url)).ok) break;
      } catch {
        // Not listening yet.
      }
      if (Date.now() > deadline) throw new Error(`${url} did not become ready within 60 s`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
};

let stopping = false;
const stopServers = (): void => {
  stopping = true;
  for (const child of children) child.kill();
};

/** Cumulative CPU seconds of a process, so each phase can report what the server spent. */
const cpuSeconds = (pid: number | undefined): number | undefined => {
  if (pid === undefined) return undefined;
  try {
    if (process.platform === 'win32')
      return Number(
        execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).CPU`], {
          encoding: 'utf8',
        }).trim(),
      );
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
    return (Number(fields[11]) + Number(fields[12])) / 100;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------------------- the principals

const BASE_URL = `http://localhost:${API_PORT}/api/v1`;
let addresses = 0;
const nextAddress = (): string => {
  addresses += 1;
  return `10.20.${Math.floor(addresses / 250)}.${(addresses % 250) + 1}`;
};

const signIn = async (): Promise<{ everyone: Session[]; principals: Principals }> => {
  const fixtures = Object.values(ACCOUNTS).filter((account) => account.role !== 'ADMINISTRATOR');
  const accounts = [
    ...fixtures,
    ...generatedAccounts().map((account) => ({ ...account, password: LOAD_ACCOUNT_PASSWORD })),
  ];
  const sessions = accounts.map((account) => new Session(account, nextAddress(), BASE_URL, record));
  // A morning's sign-ins, eight at a time.
  const queue = [...sessions];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      for (let session = queue.shift(); session; session = queue.shift()) await session.login();
    }),
  );

  const members = new Map<string, Session[]>();
  const heads = new Map<string, Session>();
  for (const session of sessions) {
    const { divisionId, role } = session.account;
    if (divisionId === null || divisionId === DIVISIONS.ord.id) continue;
    if (role === 'DIVISION_HEAD') heads.set(divisionId, session);
    members.set(divisionId, [...(members.get(divisionId) ?? []), session]);
  }
  return {
    everyone: sessions,
    principals: {
      records: sessions.filter((session) => session.account.role === 'RECORDS_STAFF'),
      director: sessions.find((session) => session.account.role === 'DIRECTOR')!,
      heads,
      members,
    },
  };
};

// ---------------------------------------------------------------------------- the actions

interface DocumentPage {
  items: { id: string }[];
  total: number;
}

const seen = new Map<Session, string[]>();
const remember = (session: Session, page: DocumentPage): void => {
  const ids = seen.get(session) ?? [];
  ids.push(...page.items.map((item) => item.id));
  seen.set(session, ids.slice(-60));
};

const journeys: Journey[] = [];
let context: JourneyContext;

const runJourneyStep = async (journey: Journey): Promise<void> => {
  journey.busy = true;
  try {
    await journey.advance(context);
  } catch (error) {
    if (error instanceof ScanPending) return;
    // A journey that failed a step is abandoned rather than retried forever; the failure counts.
    journey.step = Number.POSITIVE_INFINITY;
    throw error;
  } finally {
    journey.busy = false;
    if (journey.done) journeys.splice(journeys.indexOf(journey), 1);
  }
};

const startJourney = (): Journey => {
  const incoming = random() < 0.7;
  const journey = incoming
    ? new Journey('incoming', pick(context.principals.records))
    : new Journey('outgoing', pick([...context.principals.heads.values()]));
  journeys.push(journey);
  return journey;
};

const perform = async (operation: Operation, everyone: Session[]): Promise<void> => {
  const session = pick(everyone);
  switch (operation) {
    case 'search': {
      const term = encodeURIComponent(pick(SEARCH_TERMS));
      const page = random() < 0.25 ? '&page=2' : '';
      remember(
        session,
        await session.get('GET /documents?search', `/documents?search=${term}${page}`),
      );
      return;
    }
    case 'registry': {
      const roll = random();
      const [label, query] =
        roll < 0.4
          ? ['GET /documents', '']
          : roll < 0.6
            ? ['GET /documents?status=PENDING', '?status=PENDING']
            : roll < 0.8
              ? [
                  'GET /documents?divisionId',
                  `?divisionId=${pick([...context.principals.members.keys()])}`,
                ]
              : ['GET /documents?direction&status', '?direction=INCOMING&status=IN_PROCESS'];
      remember(session, await session.get(label, `/documents${query}`));
      return;
    }
    case 'open': {
      const ids = seen.get(session);
      if (ids === undefined || ids.length === 0) {
        remember(session, await session.get('GET /documents', '/documents'));
        return;
      }
      // What the detail page asks for when it opens.
      const id = pick(ids);
      await Promise.all([
        session.get('GET /documents/:id', `/documents/${id}`),
        session.get('GET /documents/:id/allowed-actions', `/documents/${id}/allowed-actions`),
        session.get('GET /documents/:id/attachments', `/documents/${id}/attachments`),
      ]);
      return;
    }
    case 'dashboard':
      await session.get('GET /dashboard/summary', '/dashboard/summary');
      return;
    case 'upload': {
      // Another file on a document its holder is working on.
      const held = journeys.filter(
        (journey) => !journey.busy && !journey.done && journey.custodian && journey.document,
      );
      if (held.length === 0) {
        note('upload-skipped');
        return;
      }
      const journey = pick(held);
      journey.busy = true;
      try {
        await journey.custodian!.upload(
          'POST attachment',
          `/documents/${journey.document!.id}/attachments`,
          'working-file.pdf',
          pdf(`${journey.document!.id}-${random()}`),
        );
        journey.document!.version += 1;
      } finally {
        journey.busy = false;
      }
      return;
    }
    case 'workflow': {
      const now = Date.now();
      const ready = journeys.filter(
        (journey) => !journey.busy && !journey.done && journey.notBefore <= now,
      );
      if (journeys.length < MAX_JOURNEYS && (ready.length === 0 || random() < 0.25)) {
        await runJourneyStep(startJourney());
        return;
      }
      if (ready.length === 0) {
        note('workflow-skipped');
        return;
      }
      await runJourneyStep(pick(ready));
      return;
    }
  }
};

// ---------------------------------------------------------------------------- the schedule

interface PhaseResult {
  name: string;
  offered: number;
  seconds: number;
  dispatched: number;
  dropped: number;
  dispatchLagP99: number;
  loopDelayP99: number;
  apiCpu?: number;
  workerCpu?: number;
}
const phases: PhaseResult[] = [];

const runPhase = async (name: string, rate: number, seconds: number, everyone: Session[]) => {
  phase = name;
  process.stdout.write(`\n${name}: ${rate} actions/s for ${seconds}s\n`);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const [apiPid, workerPid] = children.map((child) => child.pid);
  const apiBefore = cpuSeconds(apiPid);
  const workerBefore = cpuSeconds(workerPid);

  const started = performance.now();
  const end = started + seconds * 1_000;
  const lags: number[] = [];
  let next = started;
  let inFlight = 0;
  let dispatched = 0;
  let dropped = 0;
  let lastReport = started;
  const pending = new Set<Promise<void>>();

  while (next < end) {
    const now = performance.now();
    while (next <= now && next < end) {
      lags.push(now - next);
      next += (-Math.log(1 - random()) / rate) * 1_000;
      if (inFlight >= MAX_IN_FLIGHT) {
        dropped += 1;
        continue;
      }
      inFlight += 1;
      dispatched += 1;
      const operation = chooseOperation();
      const task = perform(operation, everyone)
        .catch(fail)
        .finally(() => {
          inFlight -= 1;
          pending.delete(task);
        });
      pending.add(task);
    }
    if (now - lastReport > 10_000) {
      lastReport = now;
      const done = samples.get(name)?.length ?? 0;
      process.stdout.write(
        `  ${((now - started) / 1000).toFixed(0)}s  ${done} requests  ${inFlight} in flight\n`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(5, next - now))));
  }
  await Promise.all(pending);
  loop.disable();

  const apiAfter = cpuSeconds(apiPid);
  const workerAfter = cpuSeconds(workerPid);
  lags.sort((a, b) => a - b);
  phases.push({
    name,
    offered: rate,
    seconds,
    dispatched,
    dropped,
    dispatchLagP99: percentile(lags, 0.99),
    loopDelayP99: loop.percentile(99) / 1e6,
    ...(apiBefore !== undefined && apiAfter !== undefined ? { apiCpu: apiAfter - apiBefore } : {}),
    ...(workerBefore !== undefined && workerAfter !== undefined
      ? { workerCpu: workerAfter - workerBefore }
      : {}),
  });
};

// ---------------------------------------------------------------------------- the report

const percentile = (sorted: readonly number[], p: number): number =>
  sorted.length === 0
    ? Number.NaN
    : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

const kindOf = (label: string): 'read' | 'write' | 'upload' | 'login' =>
  label === 'POST attachment'
    ? 'upload'
    : label === 'POST /auth/login'
      ? 'login'
      : label.startsWith('GET')
        ? 'read'
        : 'write';

const ms = (value: number): string => (Number.isNaN(value) ? '—' : `${Math.round(value)}`);

interface Verdict {
  passed: boolean;
  lines: string[];
}

const judge = (result: PhaseResult, list: Sample[]): Verdict => {
  const lines: string[] = [];
  let passed = true;
  const check = (ok: boolean, text: string) => {
    passed &&= ok;
    lines.push(`${ok ? '✅' : '❌'} ${text}`);
  };
  for (const [kind, limit] of [
    ['read', TARGET.readP95],
    ['write', TARGET.writeP95],
    ['upload', TARGET.uploadP95],
  ] as const) {
    const durations = list
      .filter((sample) => kindOf(sample.label) === kind)
      .map((sample) => sample.ms)
      .sort((a, b) => a - b);
    const p95 = percentile(durations, 0.95);
    check(
      p95 <= limit,
      `${kind} p95 ${ms(p95)} ms (target ≤ ${limit} ms, n = ${durations.length})`,
    );
  }
  const failed = list.filter((sample) => sample.status === 0 || sample.status >= 400).length;
  const serverErrors = list.filter((sample) => sample.status === 0 || sample.status >= 500).length;
  const rate = list.length === 0 ? 0 : failed / list.length;
  check(
    rate < TARGET.errorRate,
    `${(rate * 100).toFixed(2)} % of requests failed (target < 0.5 %)`,
  );
  check(serverErrors === 0, `${serverErrors} 5xx or network failures (target 0)`);
  const achieved = (result.dispatched - result.dropped) / result.seconds;
  check(
    achieved >= result.offered * 0.95 && result.dropped === 0,
    `${achieved.toFixed(1)} actions/s served of ${result.offered} offered, ${result.dropped} dropped`,
  );
  return { passed, lines };
};

const table = (list: Sample[], seconds: number): string[] => {
  const byLabel = new Map<string, Sample[]>();
  for (const sample of list)
    byLabel.set(sample.label, [...(byLabel.get(sample.label) ?? []), sample]);
  const rows = [...byLabel].sort(([a], [b]) => a.localeCompare(b));
  const lines = [
    '| Request | n | per s | p50 ms | p95 ms | p99 ms | max ms | failed |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const [label, entries] of rows) {
    const durations = entries.map((entry) => entry.ms).sort((a, b) => a - b);
    const statuses = new Map<number, number>();
    for (const entry of entries)
      if (entry.status === 0 || entry.status >= 400)
        statuses.set(entry.status, (statuses.get(entry.status) ?? 0) + 1);
    const failed = [...statuses]
      .map(([status, count]) => `${count}× ${status || 'net'}`)
      .join(', ');
    lines.push(
      `| \`${label}\` | ${entries.length} | ${(entries.length / seconds).toFixed(1)} | ${ms(percentile(durations, 0.5))} | ${ms(percentile(durations, 0.95))} | ${ms(percentile(durations, 0.99))} | ${ms(durations.at(-1) ?? Number.NaN)} | ${failed || '—'} |`,
    );
  }
  return lines;
};

const writeReport = async (signInSeconds: number, sessionCount: number): Promise<void> => {
  const commit = (() => {
    try {
      return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  })();
  const lines: string[] = [
    '# D2: load run',
    '',
    `_Generated by \`apps/api/perf/load.ts\` on ${new Date().toISOString()} at \`${commit}\`. Do not edit by hand; the verdicts are in [\`d2-load-test.md\`](d2-load-test.md)._`,
    '',
    `Machine: ${cpus().length} × ${cpus()[0]?.model.trim() ?? 'unknown CPU'}, ${(totalmem() / 2 ** 30).toFixed(0)} GiB, Node ${process.version}, ${process.platform}. The generator, the API, the worker and the compose stack all share it.`,
    '',
    `Mix: ${MIX.map(([operation, share]) => `${operation} ${share * 100} %`).join(', ')}. Uploads ${(UPLOAD_BYTES / 1024).toFixed(0)} KiB. ${sessionCount} signed-in sessions, each with its own forwarded address.`,
    '',
    `## Sign-in`,
    '',
    `${sessionCount} sessions signed in, eight at a time, in ${signInSeconds.toFixed(1)} s.`,
    '',
    ...table(samples.get('sign-in') ?? [], signInSeconds),
  ];
  for (const result of phases) {
    const list = samples.get(result.name) ?? [];
    const verdict = judge(result, list);
    const phaseNotes = [...(notes.get(result.name) ?? new Map<string, number>())]
      .map(([event, count]) => `${event} ${count}`)
      .join(', ');
    lines.push(
      '',
      `## ${result.name} — ${result.offered} actions/s for ${result.seconds} s`,
      '',
      result.name === 'warm-up'
        ? '_Not judged: caches and pools filling._'
        : `**${verdict.passed ? 'Holds' : 'Does not hold'}.**`,
      '',
      ...verdict.lines.map((line) => `- ${line}`),
      '',
      `${(list.length / result.seconds).toFixed(1)} requests/s. Generator: dispatch lag p99 ${ms(result.dispatchLagP99)} ms, event-loop delay p99 ${ms(result.loopDelayP99)} ms.` +
        (result.apiCpu === undefined
          ? ''
          : ` API CPU ${((result.apiCpu / result.seconds) * 100).toFixed(0)} % of one core, worker ${(((result.workerCpu ?? 0) / result.seconds) * 100).toFixed(0)} %.`) +
        (phaseNotes ? ` Notes: ${phaseNotes}.` : ''),
      '',
      ...table(list, result.seconds),
    );
  }
  if (failures.size > 0) {
    lines.push('', '## Failures, by message', '');
    for (const [message, count] of [...failures].sort((a, b) => b[1] - a[1]).slice(0, 25))
      lines.push(`- ${count}× \`${message.replaceAll('`', "'").replaceAll('\n', ' ')}\``);
  }
  await writeFile(OUTPUT, `${lines.join('\n')}\n`);
  process.stdout.write(`\nWrote ${fileURLToPath(OUTPUT)}\n`);
};

// ---------------------------------------------------------------------------- main

const main = async (): Promise<void> => {
  process.stdout.write(
    `Starting the API and worker against ${new URL(perfDatabaseUrl()).pathname.slice(1)}\n`,
  );
  await startServers();
  try {
    const signInStarted = performance.now();
    const { everyone, principals } = await signIn();
    const signInSeconds = (performance.now() - signInStarted) / 1000;
    process.stdout.write(`Signed in ${everyone.length} sessions in ${signInSeconds.toFixed(1)}s\n`);
    context = {
      principals,
      pdf,
      pick,
      random,
      ordDivisionId: DIVISIONS.ord.id,
      recordsSectionId: SECTIONS.records.id,
      note,
    };
    await runPhase('warm-up', TARGET_OPS, WARMUP_S, everyone);
    await runPhase('steady', TARGET_OPS, STEADY_S, everyone);
    for (const step of STEPS) await runPhase(`step ${step}`, step, STEP_S, everyone);
    await writeReport(signInSeconds, everyone.length);
  } finally {
    stopServers();
  }
};

process.on('SIGINT', () => {
  stopServers();
  process.exit(130);
});

await main();
