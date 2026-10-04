import { hash } from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { Pool, type Client } from 'pg';
import { ACCOUNTS, DIVISIONS, SECTIONS } from '../../e2e/fixtures/accounts.js';
import { assertSafeTarget, ensureDatabase, perfDatabaseUrl, withClient } from './database.js';
import {
  generatedAccounts,
  LOAD_ACCOUNT_PASSWORD,
  PERF_DIVISIONS,
  PERF_SECTIONS,
  type PerfAccount,
} from './organization.js';

/**
 * D1 of `docs/phase-7-sequencing.md`: a pilot-sized database, so the `EXPLAIN` pass and the load
 * test measure plans the pilot will actually get rather than the ones a twelve-row fixture gets.
 *
 * ## How big, and why
 *
 * Nothing in the decision register states a document volume, so the size is an assumption written
 * down where it can be corrected: **60,000 documents over five years**, about 48 a working day.
 *
 * Five years is not arbitrary. P-08 retains audit events in the primary database for five years and
 * then relocates them, so five years is the oldest the primary database is ever meant to get — the
 * largest table sizes the pilot's plans have to survive. 48 a working day is a deliberately
 * generous figure for one regional office's incoming and outgoing correspondence combined; if the
 * Records Unit's real figure is lower, every plan here is pessimistic, which is the right direction
 * to be wrong in. Override with `PILOT_DOCUMENTS`.
 *
 * ## What it models, and what it deliberately reproduces
 *
 * Incoming correspondence is registered by the Records Unit and forwarded to a handling unit;
 * outgoing is registered by the unit drafting it. Recent work is spread across the lifecycle,
 * older work is released, complied with or archived.
 *
 * **For-information copies are never accepted**, because nothing in the UI can accept one — the
 * open question at the end of Wave C. That is reproduced faithfully rather than tidied up: it is
 * the reason `document_routes_unaccepted_idx` is not the small index its comment expects, and a
 * seed that accepted the copies would hide exactly the effect D1 was asked to watch for.
 *
 * Every random draw is seeded (`setseed`), so two runs produce the same distribution.
 */

const DOCUMENTS = Number(process.env.PILOT_DOCUMENTS ?? 60_000);
const YEARS = 5;
// Share of documents forwarded with a for-information copy to a second division.
const COPY_SHARE = 0.2;
// Share of documents routed through a third unit after the first handler.
const THIRD_HOP_SHARE = 0.25;

if (!Number.isInteger(DOCUMENTS) || DOCUMENTS < 1 || DOCUMENTS > 999_999)
  // The tracking number pads to six digits and `lpad` truncates, so a seventh would collide.
  throw new Error('PILOT_DOCUMENTS must be an integer between 1 and 999,999');

const step = async (label: string, work: () => Promise<unknown>): Promise<void> => {
  const started = performance.now();
  await work();
  process.stdout.write(`  ${label} — ${((performance.now() - started) / 1000).toFixed(1)}s\n`);
};

const migrateSchema = async (url: string): Promise<void> => {
  await withClient(url, (client) =>
    client.query(
      'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
    ),
  );
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), {
      migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)),
    });
  } finally {
    await pool.end();
  }
};

const insertOrganization = async (client: Client, accounts: PerfAccount[]): Promise<void> => {
  for (const division of PERF_DIVISIONS)
    await client.query('INSERT INTO divisions (id, code, name) VALUES ($1, $2, $3)', [
      division.id,
      division.code,
      division.name,
    ]);
  for (const section of PERF_SECTIONS)
    await client.query(
      'INSERT INTO sections (id, division_id, code, name) VALUES ($1, $2, $3, $4)',
      [section.id, section.divisionId, section.code, section.name],
    );

  // The fixture principals keep their own passwords; cost 12 as in the application, so a login
  // in the load test costs what a login costs in the pilot.
  for (const account of Object.values(ACCOUNTS))
    await client.query(
      `INSERT INTO users (id, email, display_name, password_hash, role, division_id, section_id,
                          can_access_confidential)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        account.id,
        account.email,
        account.displayName,
        await hash(account.password, 12),
        account.role,
        account.divisionId,
        account.sectionId,
        account.canAccessConfidential,
      ],
    );
  // One hash for every generated account: 180 bcrypt rounds at cost 12 would be a minute of
  // seeding spent on nothing a plan depends on.
  const sharedHash = await hash(LOAD_ACCOUNT_PASSWORD, 12);
  await client.query(
    `INSERT INTO users (id, email, display_name, password_hash, role, division_id, section_id,
                        can_access_confidential)
     SELECT a.id, a.email, a.display_name, $1, a.role::role, a.division_id, a.section_id, a.conf
     FROM unnest($2::uuid[], $3::text[], $4::text[], $5::text[], $6::uuid[], $7::uuid[],
                 $8::boolean[])
       AS a(id, email, display_name, role, division_id, section_id, conf)`,
    [
      sharedHash,
      accounts.map((a) => a.id),
      accounts.map((a) => a.email),
      accounts.map((a) => a.displayName),
      accounts.map((a) => a.role),
      accounts.map((a) => a.divisionId),
      accounts.map((a) => a.sectionId),
      accounts.map((a) => a.canAccessConfidential),
    ],
  );
};

/**
 * The units a document can be handed to, each with the account that accepts a hop into it: the
 * division head for a division-level hop, a member of the section for a section hop. The ORD is
 * excluded — it registers incoming correspondence and signs outgoing, but is not a handling unit.
 */
const buildUnits = async (client: Client): Promise<void> => {
  await client.query(`
    CREATE TEMP TABLE perf_units AS
    WITH unit AS (
      SELECT d.id AS division_id, NULL::uuid AS section_id, d.code
      FROM divisions d WHERE d.code <> 'ORD'
      UNION ALL
      SELECT s.division_id, s.id, d.code
      FROM sections s JOIN divisions d ON d.id = s.division_id WHERE d.code <> 'ORD'
    )
    SELECT row_number() OVER (ORDER BY u.code, u.section_id NULLS FIRST)::int AS k,
           u.division_id, u.section_id, u.code AS division_code,
           (SELECT usr.id FROM users usr
             WHERE usr.division_id = u.division_id
               AND usr.section_id IS NOT DISTINCT FROM u.section_id
               AND usr.role IN ('DIVISION_HEAD', 'STAFF_MEMBER')
             ORDER BY usr.email LIMIT 1) AS acceptor_id
    FROM unit u`);
  const missing = await client.query('SELECT k FROM perf_units WHERE acceptor_id IS NULL');
  if (missing.rowCount) throw new Error('A handling unit has no account to accept hops into it');
};

const buildDocuments = async (client: Client): Promise<void> => {
  const pilot = await client.query<{ k: number }>(
    'SELECT k FROM perf_units WHERE division_id = $1 ORDER BY k',
    [DIVISIONS.pilot.id],
  );
  const divisionLevel = await client.query<{ k: number }>(
    'SELECT k FROM perf_units WHERE section_id IS NULL ORDER BY k',
  );
  const { rows: countRows } = await client.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM perf_units',
  );
  const unitCount = countRows[0]!.n;

  await client.query(`SELECT setseed(0.20261004)`);
  await client.query(
    `CREATE TEMP TABLE perf_docs AS
     SELECT n,
            gen_random_uuid() AS id,
            (now() - make_interval(years => $2)) + (make_interval(years => $2) * (n::float8 / $1))
              AS created_at,
            (CASE WHEN random() < 0.7 THEN 'INCOMING' ELSE 'OUTGOING' END)::document_direction
              AS direction,
            random() AS r_status, random() AS r_pending, random() AS r_hops, random() AS r_copy,
            random() AS r_unit, random() AS r_unit2, random() AS r_unit3, random() AS r_copy_unit,
            random() AS r_priority, random() AS r_type, random() AS r_conf, random() AS r_due,
            random() AS r_deleted, random() AS r_title, random() AS r_sender, random() AS r_ref
     FROM generate_series(1, $1) AS n`,
    [DOCUMENTS, YEARS],
  );
  /*
   * The handling unit. The pilot division takes 30% of the work, as the division the pilot is
   * being run with; the rest is spread uniformly over every unit, division-level and section.
   */
  await client.query(
    `ALTER TABLE perf_docs
       ADD COLUMN age_days float8, ADD COLUMN handler_k int, ADD COLUMN third_k int,
       ADD COLUMN copy_k int, ADD COLUMN status workflow_status, ADD COLUMN hops int,
       ADD COLUMN pending boolean`,
  );
  await client.query(
    `UPDATE perf_docs SET
       age_days = extract(epoch FROM now() - created_at) / 86400,
       handler_k = CASE WHEN r_unit < 0.3
                        THEN ($1::int[])[1 + floor(r_unit2 * cardinality($1::int[]))::int]
                        ELSE 1 + floor(r_unit2 * $2)::int END,
       third_k = CASE WHEN r_hops < $3 THEN 1 + floor(r_unit3 * $2)::int END,
       copy_k = CASE WHEN r_copy < $4
                     THEN ($5::int[])[1 + floor(r_copy_unit * cardinality($5::int[]))::int] END`,
    [
      pilot.rows.map((r) => r.k),
      unitCount,
      THIRD_HOP_SHARE,
      COPY_SHARE,
      divisionLevel.rows.map((r) => r.k),
    ],
  );
  // A copy to the division that already handles the document is not a copy; drop those.
  await client.query(
    `UPDATE perf_docs p SET copy_k = NULL
     FROM perf_units h, perf_units c
     WHERE h.k = p.handler_k AND c.k = p.copy_k AND h.division_id = c.division_id`,
  );
  /*
   * Status by age. Anything older than sixty days has reached the end of its life; recent work is
   * spread across the lifecycle. Incoming mail ends complied-with or archived, outgoing ends
   * released or archived.
   */
  await client.query(`
    UPDATE perf_docs SET status = (CASE
      WHEN direction = 'INCOMING' AND age_days > 60 THEN
        CASE WHEN r_status < 0.8 THEN 'ARCHIVED' ELSE 'COMPLIED' END
      WHEN direction = 'INCOMING' THEN
        CASE WHEN r_status < 0.55 THEN 'IN_PROCESS' WHEN r_status < 0.8 THEN 'COMPLIED'
             ELSE 'ARCHIVED' END
      WHEN age_days > 60 THEN
        CASE WHEN r_status < 0.7 THEN 'RELEASED' ELSE 'ARCHIVED' END
      ELSE
        CASE WHEN r_status < 0.25 THEN 'IN_PROCESS' WHEN r_status < 0.30 THEN 'FOR_REVISION'
             WHEN r_status < 0.40 THEN 'FOR_INITIAL' WHEN r_status < 0.55 THEN 'FOR_SIGNATURE'
             WHEN r_status < 0.60 THEN 'SIGNED' WHEN r_status < 0.70 THEN 'FOR_RELEASE'
             WHEN r_status < 0.90 THEN 'RELEASED' ELSE 'ARCHIVED' END
    END)::workflow_status`);
  /*
   * Lead hops: incoming is registered into the Records Unit (hop 1) and forwarded to its handler
   * (hop 2); outgoing is registered by its handler (hop 1). Either may go on to a third unit.
   * Half of the in-process work from the last fortnight has its newest lead hop still unaccepted —
   * the custody-pending documents the dashboard tile exists to surface.
   */
  await client.query(`
    UPDATE perf_docs SET
      hops = (CASE WHEN direction = 'INCOMING' THEN 2 ELSE 1 END)
             + (CASE WHEN third_k IS NOT NULL THEN 1 ELSE 0 END),
      pending = status = 'IN_PROCESS' AND age_days <= 14 AND r_pending < 0.5`);
};

const insertDocuments = async (client: Client): Promise<void> => {
  await client.query(
    `INSERT INTO documents (id, tracking_number, reference_number, title, type, description,
                            priority, direction, status, sender, company, email, division_id,
                            section_id, created_by_id, confidential, due_at, version, deleted_at,
                            deletion_reason, created_at, updated_at)
     SELECT p.id,
            'DTS-' || extract(year FROM p.created_at)::int || '-' || lpad(p.n::text, 6, '0'),
            CASE WHEN p.direction = 'OUTGOING'
                 THEN h.division_code || '-' || extract(year FROM p.created_at)::int || '-'
                      || lpad(row_number() OVER (
                           PARTITION BY p.direction, h.division_id, extract(year FROM p.created_at)
                           ORDER BY p.n)::text, 5, '0')
                 WHEN p.r_ref < 0.4 THEN 'EXT-' || p.n END,
            (ARRAY['Request for', 'Submission of', 'Notice of', 'Endorsement of', 'Compliance report on',
                   'Inquiry regarding', 'Transmittal of', 'Clarification on'])
              [1 + floor(p.r_title * 8)::int]
              || ' ' ||
            (ARRAY['mining permit', 'exploration permit renewal', 'environmental compliance certificate',
                   'quarterly safety report', 'geohazard assessment', 'tenement boundary survey',
                   'small-scale mining application', 'mineral production report', 'audit findings',
                   'personnel action', 'travel authority', 'procurement request'])
              [1 + floor(p.r_sender * 12)::int]
              || ' #' || p.n,
            CASE WHEN p.r_type < 0.40 THEN 'LETTER' WHEN p.r_type < 0.70 THEN 'MEMORANDUM'
                 WHEN p.r_type < 0.85 THEN 'DENR_8888_ACTION_CENTER'
                 WHEN p.r_type < 0.95 THEN 'SPECIAL_ORDER' ELSE 'FOI_REQUEST' END,
            CASE WHEN p.r_title < 0.5 THEN 'Synthetic pilot-volume fixture.' END,
            (CASE WHEN p.r_priority < 0.15 THEN 'LOW' WHEN p.r_priority < 0.75 THEN 'NORMAL'
                  WHEN p.r_priority < 0.95 THEN 'HIGH' ELSE 'URGENT' END)::document_priority,
            p.direction, p.status,
            CASE WHEN p.direction = 'INCOMING'
                 THEN 'Correspondent ' || (1 + floor(p.r_sender * 900)::int) END,
            CASE WHEN p.direction = 'INCOMING'
                 THEN (ARRAY['Northern Mining Corp.', 'Cordillera Aggregates', 'Provincial Government',
                             'Municipal Office', 'Private citizen', 'Agusan Minerals Inc.'])
                      [1 + floor(p.r_ref * 6)::int] END,
            CASE WHEN p.direction = 'INCOMING' AND p.r_sender < 0.5
                 THEN 'correspondent' || (1 + floor(p.r_sender * 900)::int) || '@example.org' END,
            CASE WHEN p.direction = 'INCOMING' THEN $1::uuid ELSE h.division_id END,
            CASE WHEN p.direction = 'INCOMING' THEN $2::uuid ELSE h.section_id END,
            CASE WHEN p.direction = 'INCOMING' THEN $3::uuid ELSE h.acceptor_id END,
            p.r_conf < 0.05,
            CASE WHEN p.direction = 'INCOMING' AND p.r_due < 0.7 THEN p.created_at + interval '15 days' END,
            1 + p.hops,
            CASE WHEN p.r_deleted < 0.005 AND p.age_days > 30 THEN p.created_at + interval '30 days' END,
            CASE WHEN p.r_deleted < 0.005 AND p.age_days > 30 THEN 'Registered in error.' END,
            p.created_at, p.created_at + make_interval(days => p.hops)
     FROM perf_docs p JOIN perf_units h ON h.k = p.handler_k`,
    [DIVISIONS.ord.id, SECTIONS.records.id, ACCOUNTS.records.id],
  );
};

/**
 * `document_routes`, in the order the custody chain was walked: registration, forward, onward.
 * A hop's acceptance is two hours after it was made unless it is the pending document's newest
 * lead hop; for-information copies are never accepted (see the header).
 */
const insertRoutes = async (client: Client): Promise<void> => {
  await client.query(
    `CREATE TEMP TABLE perf_hops AS
     -- Hop 1: registration into the registering unit.
     SELECT p.id AS document_id, 1 AS seq, NULL::uuid AS from_division_id,
            CASE WHEN p.direction = 'INCOMING' THEN $1::uuid ELSE h.division_id END AS to_division_id,
            CASE WHEN p.direction = 'INCOMING' THEN $2::uuid ELSE h.section_id END AS to_section_id,
            CASE WHEN p.direction = 'INCOMING' THEN $3::uuid ELSE h.acceptor_id END AS actor_id,
            false AS for_information, p.created_at AS at, p.hops = 1 AND p.pending AS open
     FROM perf_docs p JOIN perf_units h ON h.k = p.handler_k
     UNION ALL
     -- Hop 2 (incoming only): the Records Unit forwards to the handler.
     SELECT p.id, 2, $1::uuid, h.division_id, h.section_id, h.acceptor_id, false,
            p.created_at + interval '1 day', p.hops = 2 AND p.pending
     FROM perf_docs p JOIN perf_units h ON h.k = p.handler_k
     WHERE p.direction = 'INCOMING'
     UNION ALL
     -- The onward hop, from the handler to a third unit.
     SELECT p.id, p.hops, h.division_id, t.division_id, t.section_id, t.acceptor_id, false,
            p.created_at + make_interval(days => p.hops - 1), p.pending
     FROM perf_docs p JOIN perf_units h ON h.k = p.handler_k JOIN perf_units t ON t.k = p.third_k
     UNION ALL
     -- The for-information copy, to a second division, at the time of the handler's forward.
     SELECT p.id, 99, h.division_id, c.division_id, NULL, c.acceptor_id, true,
            p.created_at + interval '1 day 1 minute', true
     FROM perf_docs p JOIN perf_units h ON h.k = p.handler_k JOIN perf_units c ON c.k = p.copy_k`,
    [DIVISIONS.ord.id, SECTIONS.records.id, ACCOUNTS.records.id],
  );
  await client.query(
    `INSERT INTO document_routes (document_id, from_division_id, to_division_id, to_section_id,
                                  routed_by_id, for_information, accepted_at, accepted_by_id,
                                  remarks, created_at)
     SELECT document_id, from_division_id, to_division_id, to_section_id, $1::uuid,
            for_information,
            CASE WHEN open THEN NULL ELSE at + interval '2 hours' END,
            CASE WHEN open THEN NULL ELSE actor_id END,
            CASE WHEN seq > 1 THEN 'For appropriate action.' END,
            at
     FROM perf_hops`,
    [ACCOUNTS.records.id],
  );
};

/**
 * The timeline. Each document carries the events its status implies — custody acceptances, then
 * the lifecycle actions that brought it to where it is — at hourly steps after its last hop.
 */
const insertWorkflowEvents = async (client: Client): Promise<void> => {
  await client.query(
    `WITH chain AS (
       SELECT p.id, p.created_at, p.hops, h.acceptor_id AS actor_id,
              CASE p.direction
                WHEN 'INCOMING' THEN
                  CASE p.status WHEN 'COMPLIED' THEN ARRAY['COMPLY']
                                WHEN 'ARCHIVED' THEN ARRAY['COMPLY', 'ARCHIVE']
                                ELSE ARRAY[]::text[] END
                ELSE
                  (ARRAY['SUBMIT_FOR_INITIAL', 'INITIAL', 'SIGN', 'PREPARE_RELEASE', 'RELEASE', 'ARCHIVE'])
                  [1:CASE p.status WHEN 'FOR_INITIAL' THEN 1 WHEN 'FOR_REVISION' THEN 1
                                   WHEN 'FOR_SIGNATURE' THEN 2 WHEN 'SIGNED' THEN 3
                                   WHEN 'FOR_RELEASE' THEN 4 WHEN 'RELEASED' THEN 5
                                   WHEN 'ARCHIVED' THEN 6 ELSE 0 END]
              END AS actions,
              p.pending
       FROM perf_docs p JOIN perf_units h ON h.k = p.handler_k
     ),
     accepts AS (
       SELECT c.id, gs AS seq, 'ACCEPT' AS action, c.actor_id,
              'IN_PROCESS' AS from_status, 'IN_PROCESS' AS to_status,
              c.created_at + make_interval(days => gs - 1, hours => 2) AS at
       FROM chain c, generate_series(1, c.hops - CASE WHEN c.pending THEN 1 ELSE 0 END) gs
     ),
     lifecycle AS (
       SELECT c.id, c.hops + o AS seq, c.actions[o] AS action, c.actor_id,
              NULL::text AS from_status, c.actions[o] AS to_status,
              c.created_at + make_interval(days => c.hops, hours => o) AS at
       FROM chain c, generate_series(1, coalesce(cardinality(c.actions), 0)) o
     )
     INSERT INTO workflow_events (document_id, sequence, actor_id, action, from_status, to_status,
                                  remarks, occurred_at)
     SELECT id, seq, actor_id, action, from_status,
            CASE action WHEN 'ACCEPT' THEN 'IN_PROCESS' WHEN 'COMPLY' THEN 'COMPLIED'
                        WHEN 'ARCHIVE' THEN 'ARCHIVED' WHEN 'SUBMIT_FOR_INITIAL' THEN 'FOR_INITIAL'
                        WHEN 'INITIAL' THEN 'FOR_SIGNATURE' WHEN 'SIGN' THEN 'SIGNED'
                        WHEN 'PREPARE_RELEASE' THEN 'FOR_RELEASE' WHEN 'RELEASE' THEN 'RELEASED'
                        ELSE to_status END,
            CASE WHEN action = 'COMPLY' THEN 'Complied with as instructed.' END,
            least(at, now())
     FROM (SELECT * FROM accepts UNION ALL SELECT * FROM lifecycle) e`,
  );
};

/**
 * The supporting tables, sized by what each action writes: an audit row per creation, hop,
 * acceptance and lifecycle action, plus a sign-in a working day per account; a notification per
 * hop; one attachment on most documents; a release event per released outgoing document.
 */
const insertSupportingRows = async (client: Client, accountCount: number): Promise<void> => {
  await step('audit events (document actions)', () =>
    client.query(
      `INSERT INTO audit_events (actor_id, action, target_type, target_id, outcome, correlation_id,
                                 summary, occurred_at)
       SELECT d.created_by_id, 'document.created', 'document', d.id::text, 'SUCCESS'::audit_outcome,
              gen_random_uuid(), jsonb_build_object('trackingNumber', d.tracking_number),
              d.created_at
       FROM documents d
       UNION ALL
       SELECT r.routed_by_id, 'document.routed', 'document', r.document_id::text, 'SUCCESS',
              gen_random_uuid(), jsonb_build_object('toDivisionId', r.to_division_id), r.created_at
       FROM document_routes r WHERE r.from_division_id IS NOT NULL
       UNION ALL
       SELECT e.actor_id, 'workflow.' || lower(e.action), 'document', e.document_id::text,
              'SUCCESS', gen_random_uuid(), jsonb_build_object('toStatus', e.to_status),
              e.occurred_at
       FROM workflow_events e`,
    ),
  );
  // Roughly one sign-in per account per working day, with a few failures among them.
  await step('audit events (sign-ins)', () =>
    client.query(
      `INSERT INTO audit_events (actor_id, action, target_type, target_id, outcome, correlation_id,
                                 source_ip, summary, occurred_at)
       SELECT u.id, 'auth.login', 'user', u.id::text,
              (CASE WHEN random() < 0.03 THEN 'FAILURE' ELSE 'SUCCESS' END)::audit_outcome,
              gen_random_uuid(), '10.0.0.' || (1 + floor(random() * 250)::int), '{}'::jsonb,
              now() - make_interval(days => gs) + make_interval(hours => 8 + floor(random() * 9)::int)
       FROM users u, generate_series(1, $1) gs
       WHERE extract(isodow FROM now() - make_interval(days => gs)) < 6
         AND random() < 0.9`,
      [YEARS * 365],
    ),
  );
  await step('notifications', () =>
    client.query(
      `INSERT INTO notifications (recipient_user_id, type, title, body, document_id, idempotency_key,
                                  read_at, created_at)
       SELECT coalesce(u.acceptor_id, h.division_head), 'document.routed',
              'Document forwarded to your unit', 'A document awaits your action.', r.document_id,
              'perf:' || r.id, CASE WHEN r.created_at < now() - interval '7 days'
                                    THEN r.created_at + interval '3 hours' END,
              r.created_at
       FROM document_routes r
       LEFT JOIN perf_units u ON u.division_id = r.to_division_id
                             AND u.section_id IS NOT DISTINCT FROM r.to_section_id
       LEFT JOIN LATERAL (SELECT usr.id AS division_head FROM users usr
                          WHERE usr.division_id = r.to_division_id
                          ORDER BY usr.role, usr.email LIMIT 1) h ON true
       WHERE r.from_division_id IS NOT NULL`,
    ),
  );
  await step('assignments and shares', async () => {
    await client.query(
      `INSERT INTO document_assignments (document_id, user_id, active, assigned_by_id, created_at,
                                         updated_at)
       SELECT p.id, staff.id, p.status NOT IN ('ARCHIVED', 'RELEASED', 'COMPLIED'), h.acceptor_id,
              p.created_at + interval '1 day', p.created_at + interval '1 day'
       FROM perf_docs p
       JOIN perf_units h ON h.k = p.handler_k
       JOIN LATERAL (SELECT usr.id FROM users usr
                     WHERE usr.division_id = h.division_id AND usr.role = 'STAFF_MEMBER'
                     ORDER BY md5(usr.id::text || p.n) LIMIT 1) staff ON true
       WHERE p.r_unit3 < 0.3`,
    );
    await client.query(
      `INSERT INTO document_shares (document_id, user_id, shared_by_id, created_at)
       SELECT p.id, usr.id, $1::uuid, p.created_at + interval '2 days'
       FROM perf_docs p
       JOIN LATERAL (SELECT id FROM users WHERE role = 'STAFF_MEMBER'
                     ORDER BY md5(id::text || p.n) LIMIT 1) usr ON true
       WHERE p.r_copy_unit < 0.02`,
      [ACCOUNTS.records.id],
    );
  });
  await step('attachments', async () => {
    await client.query(
      `INSERT INTO file_records (id, document_id, display_name, created_by_id, created_at)
       SELECT gen_random_uuid(), d.id, 'scan-' || d.tracking_number || '.pdf', d.created_by_id,
              d.created_at
       FROM documents d JOIN perf_docs p ON p.id = d.id WHERE p.r_due < 0.85`,
    );
    // Metadata only: no object is written to storage. Nothing in D1 reads the bytes, and D2 uploads
    // and downloads its own files rather than fetching keys that point nowhere.
    await client.query(
      `INSERT INTO file_versions (file_record_id, version_number, object_key, original_name,
                                  media_type, size_bytes, checksum_sha256, uploader_id, scan_status,
                                  uploaded_at)
       SELECT f.id, 1, 'perf/' || f.id, f.display_name, 'application/pdf',
              150000 + floor(random() * 2000000)::int, md5(f.id::text) || md5(f.display_name),
              f.created_by_id, 'CLEAN', f.created_at
       FROM file_records f`,
    );
    await client.query(
      `UPDATE documents d SET current_file_version_id = v.id
       FROM file_records f JOIN file_versions v ON v.file_record_id = f.id
       WHERE f.document_id = d.id`,
    );
  });
  await step('releases and reference links', async () => {
    await client.query(
      `INSERT INTO release_events (document_id, released_by_id, method_id, tracking_reference,
                                   released_at)
       SELECT d.id, $1::uuid, m.id,
              CASE WHEN m.requires_tracking_reference THEN m.code || '-' || d.tracking_number END,
              d.updated_at
       FROM documents d
       JOIN perf_docs p ON p.id = d.id
       JOIN release_methods m
         ON m.sort_order = 1 + floor(p.r_ref * (SELECT count(*) FROM release_methods))::int
       WHERE d.direction = 'OUTGOING' AND d.status IN ('RELEASED', 'ARCHIVED')`,
      [ACCOUNTS.records.id],
    );
    await client.query(`CREATE INDEX ON perf_docs (n) WHERE direction = 'INCOMING'`);
    // A reply names an incoming document registered before it — the nearest one, which keeps the
    // join cheap and the pairs plausible.
    await client.query(
      `INSERT INTO document_references (outgoing_document_id, incoming_document_id, created_by_id,
                                        created_at)
       SELECT o.id, i.id, od.created_by_id, o.created_at
       FROM perf_docs o
       JOIN LATERAL (SELECT id FROM perf_docs
                     WHERE direction = 'INCOMING' AND n < o.n ORDER BY n DESC LIMIT 1) i ON true
       JOIN documents od ON od.id = o.id
       WHERE o.direction = 'OUTGOING' AND o.r_ref < 0.3`,
    );
  });
  await step('outbox and counters', async () => {
    await client.query(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload, idempotency_key,
                                  attempts, published_at, created_at)
       SELECT 'document', d.id, 'document.created', jsonb_build_object('documentId', d.id),
              'document.created:' || d.id, 1, d.created_at + interval '2 seconds', d.created_at
       FROM documents d`,
    );
    // So the load test's registrations continue the sequences instead of colliding with them.
    await client.query(`INSERT INTO document_sequences (scope, value) VALUES ('TRACKING', $1)`, [
      DOCUMENTS,
    ]);
    await client.query(
      `INSERT INTO reference_counters (division_id, year, value)
       SELECT division_id, extract(year FROM created_at)::int, count(*)
       FROM documents WHERE direction = 'OUTGOING'
       GROUP BY division_id, extract(year FROM created_at)`,
    );
  });
  process.stdout.write(`  (${accountCount} accounts)\n`);
};

const report = async (client: Client): Promise<void> => {
  const { rows } = await client.query<{ relname: string; rows: string; size: string }>(
    `SELECT c.relname, c.reltuples::bigint::text AS rows,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS size
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.reltuples > 0
     ORDER BY c.reltuples DESC`,
  );
  process.stdout.write('\nTable sizes after ANALYZE:\n');
  for (const row of rows)
    process.stdout.write(`  ${row.relname.padEnd(28)} ${row.rows.padStart(9)}  ${row.size}\n`);
};

const main = async (): Promise<void> => {
  const url = perfDatabaseUrl();
  assertSafeTarget(url);
  process.stdout.write(
    `Seeding ${DOCUMENTS.toLocaleString()} documents into ${new URL(url).pathname.slice(1)}\n`,
  );
  await ensureDatabase(url);
  await step('schema (drop + migrate)', () => migrateSchema(url));
  const accounts = generatedAccounts();
  await withClient(url, async (client) => {
    await step('organization and accounts', () => insertOrganization(client, accounts));
    await step('documents', async () => {
      await buildUnits(client);
      await buildDocuments(client);
      await insertDocuments(client);
    });
    await step('routes', () => insertRoutes(client));
    await step('workflow events', () => insertWorkflowEvents(client));
    await insertSupportingRows(client, accounts.length + Object.keys(ACCOUNTS).length);
    await step('VACUUM ANALYZE', () => client.query('VACUUM ANALYZE'));
    await report(client);
  });
};

await main();
