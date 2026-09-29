import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { hashSync } from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '../src/modules/authorization/authorization.policy.js';
import { documentScopeFor } from '../src/modules/authorization/query-scope.js';
import {
  divisions,
  documentAssignments,
  documentShares,
  documents,
  sections,
  users,
} from '../src/database/schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');
if (process.env.ALLOW_DATABASE_RESET !== 'true')
  throw new Error('ALLOW_DATABASE_RESET=true is required for the destructive query-scope int test');

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool);

// Identifiers are fixed so assertions can name the rows they expect.
const DIV_A = '00000000-0000-4000-9000-0000000000a0';
const DIV_B = '00000000-0000-4000-9000-0000000000b0';
const SEC_A1 = '00000000-0000-4000-9000-0000000000a1';
const SEC_B1 = '00000000-0000-4000-9000-0000000000b1';

// Document primary keys are UUIDs; the readable label rides on the tracking number.
const DOC_A_SECTION = randomUUID();
const DOC_A_DIVISION = randomUUID();
const DOC_B = randomUUID();
const DOC_A_CONFIDENTIAL = randomUUID();
const DOC_ASSIGNED = randomUUID();
const DOC_SHARED = randomUUID();

// User rows only need the columns the scope SQL and foreign keys touch.
const seedUser = (id: string) => ({
  id,
  email: `${id}@dts.local`,
  displayName: id,
  passwordHash: hashSync('irrelevant-for-scope', 4),
  role: 'STAFF_MEMBER' as const,
  divisionId: null,
  sectionId: null,
  canAccessConfidential: false,
});

const CREATOR = '00000000-0000-4000-9000-00000000c000';
const STAFF_B = '00000000-0000-4000-9000-00000000b002';

const doc = (id: string, overrides: Record<string, unknown>) => ({
  id,
  trackingNumber: `TRK-${id.slice(0, 8)}`,
  title: `Document ${id.slice(0, 8)}`,
  type: 'LETTER',
  priority: 'NORMAL' as const,
  direction: 'INCOMING' as const,
  divisionId: DIV_A,
  createdById: CREATOR,
  confidential: false,
  ...overrides,
});

// A valid UUID that is neither an assignee nor a sharee, so the default actor is reachable
// only through division/section scope (the assignment/share subqueries cast id to uuid).
const ACTOR_ID = randomUUID();

const actor = (overrides: Partial<AuthorizationActor>): AuthorizationActor => ({
  id: ACTOR_ID,
  role: 'STAFF_MEMBER',
  divisionId: null,
  sectionId: null,
  capabilities: [],
  canAccessConfidential: false,
  ...overrides,
});

// Exercises the SQL predicate a repository composes into its WHERE clause. `scopeToActor` is
// the thin call-site wrapper around this — `query.where(documentScopeFor(actor))` — so pinning
// the predicate pins the behaviour every scoped list, count and export will inherit.
const visibleTo = async (a: AuthorizationActor): Promise<string[]> => {
  const rows = await db.select({ id: documents.id }).from(documents).where(documentScopeFor(a));
  return rows.map((row) => row.id).sort();
};

describe('documentScopeFor / scopeToActor against a real database', () => {
  beforeAll(async () => {
    await db.execute(
      sql.raw(
        'DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;',
      ),
    );
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });

    await db.insert(divisions).values([
      { id: DIV_A, code: 'DIV-A', name: 'Division A' },
      { id: DIV_B, code: 'DIV-B', name: 'Division B' },
    ]);
    await db.insert(sections).values([
      { id: SEC_A1, divisionId: DIV_A, code: 'A1', name: 'Section A1' },
      { id: SEC_B1, divisionId: DIV_B, code: 'B1', name: 'Section B1' },
    ]);
    await db.insert(users).values([seedUser(CREATOR), seedUser(STAFF_B)]);

    await db
      .insert(documents)
      .values([
        doc(DOC_A_SECTION, { divisionId: DIV_A, sectionId: SEC_A1 }),
        doc(DOC_A_DIVISION, { divisionId: DIV_A, sectionId: null }),
        doc(DOC_B, { divisionId: DIV_B, sectionId: SEC_B1 }),
        doc(DOC_A_CONFIDENTIAL, { divisionId: DIV_A, sectionId: SEC_A1, confidential: true }),
        doc(DOC_ASSIGNED, { divisionId: DIV_A, sectionId: SEC_A1 }),
        doc(DOC_SHARED, { divisionId: DIV_A, sectionId: SEC_A1 }),
      ]);

    // Reachability that does not come from division/section: an assignment and a share to a
    // staff member who sits in a different division.
    await db.insert(documentAssignments).values({
      documentId: DOC_ASSIGNED,
      userId: STAFF_B,
      active: true,
      assignedById: CREATOR,
    });
    await db
      .insert(documentShares)
      .values({ documentId: DOC_SHARED, userId: STAFF_B, sharedById: CREATOR });
  }, 30_000);

  afterAll(async () => {
    await pool.end();
  });

  it('gives records staff every non-confidential document but withholds confidential ones', async () => {
    expect(await visibleTo(actor({ role: 'RECORDS_STAFF' }))).toEqual(
      [DOC_A_SECTION, DOC_A_DIVISION, DOC_B, DOC_ASSIGNED, DOC_SHARED].sort(),
    );
  });

  it('unlocks confidential documents only with explicit access', async () => {
    expect(
      await visibleTo(actor({ role: 'ADMINISTRATOR', canAccessConfidential: true })),
    ).toContain(DOC_A_CONFIDENTIAL);
  });

  it('limits a division head to their own division', async () => {
    expect(await visibleTo(actor({ role: 'DIVISION_HEAD', divisionId: DIV_A }))).toEqual(
      [DOC_A_SECTION, DOC_A_DIVISION, DOC_ASSIGNED, DOC_SHARED].sort(),
    );
  });

  it('limits a staff member to their own section and withholds confidential rows', async () => {
    // Same section as DOC_A_SECTION/ASSIGNED/SHARED, so those are reachable; the confidential
    // row in that section is still withheld, and the section-less division row is out of reach.
    expect(
      await visibleTo(actor({ role: 'STAFF_MEMBER', divisionId: DIV_A, sectionId: SEC_A1 })),
    ).toEqual([DOC_A_SECTION, DOC_ASSIGNED, DOC_SHARED].sort());
  });

  it('reaches a cross-division staff member only through assignment and share', async () => {
    expect(
      await visibleTo(
        actor({ id: STAFF_B, role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId: SEC_B1 }),
      ),
    ).toEqual([DOC_B, DOC_ASSIGNED, DOC_SHARED].sort());
  });
});
