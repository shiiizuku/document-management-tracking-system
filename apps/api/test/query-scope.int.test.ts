import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { hashSync } from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '../src/modules/authorization/authorization.policy.js';
import type { Database } from '../src/database/client.js';
import { DocumentsRepository } from '../src/modules/documents/documents.repository.js';
import {
  custodyDivisionId,
  custodySectionId,
  documentIsOverdue,
  documentIsPending,
  documentScopeFor,
} from '../src/modules/authorization/query-scope.js';
import {
  divisions,
  documentAssignments,
  documentReferences,
  documentRoutes,
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
// A third division with no documents of its own, so a copy for information is the only way
// anything reaches it — which is what the for-information cases need to prove.
const DIV_C = '00000000-0000-4000-9000-0000000000c0';
const SEC_A1 = '00000000-0000-4000-9000-0000000000a1';
const SEC_B1 = '00000000-0000-4000-9000-0000000000b1';
const SEC_B2 = '00000000-0000-4000-9000-0000000000b2';
const SEC_C1 = '00000000-0000-4000-9000-0000000000c1';

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
      { id: DIV_C, code: 'DIV-C', name: 'Division C' },
    ]);
    await db.insert(sections).values([
      { id: SEC_A1, divisionId: DIV_A, code: 'A1', name: 'Section A1' },
      { id: SEC_B1, divisionId: DIV_B, code: 'B1', name: 'Section B1' },
      { id: SEC_B2, divisionId: DIV_B, code: 'B2', name: 'Section B2' },
      { id: SEC_C1, divisionId: DIV_C, code: 'C1', name: 'Section C1' },
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

  /*
   * The Director's branch, which the in-memory policy asserts separately. Worth its own case
   * against real Postgres because this is the first role that is placed in a division *and* reads
   * the whole office: a scope predicate that leaned on `divisionId === null` to mean "unplaced"
   * would quietly narrow the Director to its own division, and only SQL would show it.
   */
  it('gives the director every division but still withholds confidential rows', async () => {
    const director = actor({ role: 'DIRECTOR', divisionId: DIV_B });
    expect(await visibleTo(director)).toEqual(
      [DOC_A_SECTION, DOC_A_DIVISION, DOC_B, DOC_ASSIGNED, DOC_SHARED].sort(),
    );
    expect(await visibleTo({ ...director, canAccessConfidential: true })).toContain(
      DOC_A_CONFIDENTIAL,
    );
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

  /**
   * `PENDING` is the one status with no column behind it: it is the existence of an unaccepted
   * route (ADR-0005). Every list, dashboard rollup and report that offers it as a filter composes
   * `documentIsPending`, so this pins what that predicate means against real Postgres — including
   * that the complement is its exact inverse, which is what stops a "pending" filter and an
   * "everything else" filter from together showing a document twice or not at all.
   *
   * Nested inside the scope suite so it shares its fixtures and its connection pool.
   */
  describe('documentIsPending', () => {
    const pendingIds = async (pending: boolean): Promise<string[]> => {
      const rows = await db
        .select({ id: documents.id })
        .from(documents)
        .where(documentIsPending(pending));
      return rows.map((row) => row.id).sort();
    };

    beforeAll(async () => {
      // One hop per document: accepted on the section document, outstanding on the division one,
      // and a for-information copy on the division document that must not change the answer.
      await db.insert(documentRoutes).values([
        {
          documentId: DOC_A_SECTION,
          toDivisionId: DIV_A,
          toSectionId: SEC_A1,
          routedById: CREATOR,
          acceptedAt: new Date('2026-10-02T08:00:00Z'),
          acceptedById: CREATOR,
        },
        {
          documentId: DOC_A_DIVISION,
          toDivisionId: DIV_A,
          routedById: CREATOR,
        },
        {
          documentId: DOC_B,
          toDivisionId: DIV_B,
          toSectionId: SEC_B1,
          routedById: CREATOR,
          forInformation: true,
        },
      ]);
    });

    it('counts a document with any unaccepted hop as pending', async () => {
      // DOC_B's only hop is a for-information copy and is unaccepted: it is an outstanding
      // acknowledgement, and the document is pending at it. Only the *lead* route gates progress,
      // which is the workflow engine's concern rather than this predicate's.
      expect(await pendingIds(true)).toEqual([DOC_A_DIVISION, DOC_B].sort());
    });

    it('excludes documents whose hops are all accepted, and those with no hops at all', async () => {
      expect(await pendingIds(false)).toEqual(
        [DOC_A_SECTION, DOC_A_CONFIDENTIAL, DOC_ASSIGNED, DOC_SHARED].sort(),
      );
    });

    it('partitions the table exactly, so the two halves can never disagree', async () => {
      const [pending, settled, all] = await Promise.all([
        pendingIds(true),
        pendingIds(false),
        db.select({ id: documents.id }).from(documents),
      ]);
      expect([...pending, ...settled].sort()).toEqual(all.map((row) => row.id).sort());
    });
  });

  /**
   * `documentIsOverdue` is the one definition behind the dashboard's Overdue tile and the
   * registry's `overdue=true` filter. This pins what it means against real Postgres: open past its
   * due date, where "open" is every status but RELEASED and ARCHIVED — so a COMPLIED document past
   * its due date still counts, which is the rule as it stands, recorded rather than endorsed.
   *
   * Nested here for the fixtures; it puts every row it touches back as it found it, so the exact-id
   * suites around it are unaffected.
   */
  describe('documentIsOverdue', () => {
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

    const overdueIds = async (): Promise<string[]> => {
      const rows = await db.select({ id: documents.id }).from(documents).where(documentIsOverdue());
      return rows.map((row) => row.id).sort();
    };

    beforeAll(async () => {
      await db.update(documents).set({ dueAt: past }).where(eq(documents.id, DOC_A_SECTION));
      await db.update(documents).set({ dueAt: future }).where(eq(documents.id, DOC_A_DIVISION));
      await db
        .update(documents)
        .set({ dueAt: past, status: 'RELEASED' })
        .where(eq(documents.id, DOC_B));
      await db
        .update(documents)
        .set({ dueAt: past, status: 'ARCHIVED' })
        .where(eq(documents.id, DOC_ASSIGNED));
      await db
        .update(documents)
        .set({ dueAt: past, status: 'COMPLIED' })
        .where(eq(documents.id, DOC_SHARED));
    });

    afterAll(async () => {
      await db
        .update(documents)
        .set({ dueAt: null, status: 'IN_PROCESS' })
        .where(
          inArray(documents.id, [DOC_A_SECTION, DOC_A_DIVISION, DOC_B, DOC_ASSIGNED, DOC_SHARED]),
        );
    });

    it('counts an open document past its due date, and a complied one too', async () => {
      expect(await overdueIds()).toEqual([DOC_A_SECTION, DOC_SHARED].sort());
    });

    it('ignores a future due date, no due date, and the two closed statuses', async () => {
      const ids = await overdueIds();
      for (const id of [DOC_A_DIVISION, DOC_A_CONFIDENTIAL, DOC_B, DOC_ASSIGNED]) {
        expect(ids).not.toContain(id);
      }
    });

    it('composes with scope, as the registry filter does', async () => {
      const rows = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            documentIsOverdue(),
            documentScopeFor(actor({ role: 'DIVISION_HEAD', divisionId: DIV_B })),
          ),
        );
      // DOC_B is in Division B but released; nothing overdue is left there.
      expect(rows).toEqual([]);
    });
  });

  /**
   * The route half of placement scope, against real Postgres (ADR-0005).
   *
   * These documents are registered in Division A and then forwarded, so nothing on the document row
   * names the unit that holds them: `documents.division_id` is the registering placement and never
   * moves. Every case here has a twin in `authorization.test.ts`, which asserts the same answers
   * from the in-memory policy — the two agreeing is the only reason a list may be scoped in SQL
   * while a capability is checked in TypeScript.
   *
   * Declared last in the file so its fixture rows cannot disturb the suites above, which assert
   * exact id lists over the whole table.
   */
  describe('placement through custody hops', () => {
    const FORWARDED = randomUUID();
    const COPIED = randomUUID();

    const reaching = async (a: AuthorizationActor): Promise<string[]> =>
      (await visibleTo(a)).filter((id) => id === FORWARDED || id === COPIED);

    beforeAll(async () => {
      await db
        .insert(documents)
        .values([
          doc(FORWARDED, { divisionId: DIV_A, sectionId: SEC_A1 }),
          doc(COPIED, { divisionId: DIV_A, sectionId: SEC_A1 }),
        ]);
      /*
       * `createdAt` is set explicitly on every hop. The column defaults to `now()`, which in
       * Postgres is the *transaction* clock — so hops written in one statement, as these are, would
       * all share a timestamp and leave "which hop is the latest" to an arbitrary tie-break on a
       * random id. In production each hop is its own transaction and the question never arises;
       * here the fixture has to say what the production clock would have said.
       */
      const at = (minute: number) => new Date(`2026-10-02T09:0${minute}:00Z`);
      await db.insert(documentRoutes).values([
        // How each document reached Division A in the first place: registration hands it over
        // unaccepted, because registering confers no custody (decision 154).
        {
          documentId: FORWARDED,
          toDivisionId: DIV_A,
          toSectionId: SEC_A1,
          routedById: CREATOR,
          createdAt: at(0),
        },
        {
          documentId: COPIED,
          toDivisionId: DIV_A,
          toSectionId: SEC_A1,
          routedById: CREATOR,
          createdAt: at(0),
        },
        // The forward itself: one lead recipient (decision 159) and, on COPIED, one division
        // consulted for information (decision 160).
        {
          documentId: FORWARDED,
          fromDivisionId: DIV_A,
          toDivisionId: DIV_B,
          toSectionId: SEC_B1,
          routedById: CREATOR,
          createdAt: at(1),
        },
        {
          documentId: COPIED,
          fromDivisionId: DIV_A,
          toDivisionId: DIV_B,
          toSectionId: SEC_B1,
          routedById: CREATOR,
          createdAt: at(1),
        },
        {
          documentId: COPIED,
          fromDivisionId: DIV_A,
          toDivisionId: DIV_C,
          toSectionId: null,
          routedById: CREATOR,
          forInformation: true,
          // Written after the lead hop, so custody must still report the lead: a copy for
          // information is the newest row on the document and never the one holding it.
          createdAt: at(2),
        },
      ]);
    });

    it('reaches the section a document was forwarded to, and its division head', async () => {
      expect(
        await reaching(actor({ role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId: SEC_B1 })),
      ).toEqual([FORWARDED, COPIED].sort());
      expect(await reaching(actor({ role: 'DIVISION_HEAD', divisionId: DIV_B }))).toEqual(
        [FORWARDED, COPIED].sort(),
      );
    });

    it('does not reach a sibling section in the receiving division', async () => {
      expect(
        await reaching(actor({ role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId: SEC_B2 })),
      ).toEqual([]);
    });

    /*
     * Decision 176. No clause in the predicate grants this: the hop by which Section A1 received
     * the document is still on record, so read accumulates along the custody chain rather than
     * transferring. The behaviour this replaced did the opposite — `relocate` moved the column and
     * the sending unit lost the document outright.
     */
    it('keeps the forwarding unit on documents it has passed onward', async () => {
      expect(
        await reaching(actor({ role: 'STAFF_MEMBER', divisionId: DIV_A, sectionId: SEC_A1 })),
      ).toEqual([FORWARDED, COPIED].sort());
    });

    it('reaches a copied-in division head but not that division’s sections', async () => {
      expect(await reaching(actor({ role: 'DIVISION_HEAD', divisionId: DIV_C }))).toEqual([COPIED]);
      expect(
        await reaching(actor({ role: 'STAFF_MEMBER', divisionId: DIV_C, sectionId: SEC_C1 })),
      ).toEqual([]);
    });

    // Decision 180: a lead hop naming no section reaches every section of that division.
    it('reaches every section of a division forwarded to as a whole', async () => {
      const divisionWide = randomUUID();
      await db
        .insert(documents)
        .values(doc(divisionWide, { divisionId: DIV_A, sectionId: SEC_A1 }));
      await db
        .insert(documentRoutes)
        .values({ documentId: divisionWide, toDivisionId: DIV_B, routedById: CREATOR });
      for (const sectionId of [SEC_B1, SEC_B2]) {
        expect(
          await visibleTo(actor({ role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId })),
        ).toContain(divisionWide);
      }
      expect(
        await visibleTo(actor({ role: 'STAFF_MEMBER', divisionId: DIV_C, sectionId: SEC_C1 })),
      ).not.toContain(divisionWide);
    });

    /*
     * Both hops here are unaccepted, and the recipients above reach them anyway. That is the
     * resolution of ADR-0005's "scope resolves through accepted route rows", which read literally
     * is unimplementable: `ACCEPT` is reached from the detail view, so a recipient who cannot read
     * a document could never accept it. Acceptance gates actions; it does not gate visibility.
     */
    it('reaches recipients of hops nobody has accepted yet', async () => {
      // Every hop in this suite is unaccepted — stated rather than assumed, because the reach
      // asserted above means nothing if the fixtures had quietly been accepted.
      const accepted = await db
        .select({ id: documentRoutes.id })
        .from(documentRoutes)
        .where(
          and(
            inArray(documentRoutes.documentId, [FORWARDED, COPIED]),
            isNotNull(documentRoutes.acceptedAt),
          ),
        );
      expect(accepted).toEqual([]);
      expect(
        await reaching(actor({ role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId: SEC_B1 })),
      ).toContain(FORWARDED);
    });

    /**
     * The custody expressions the registry filter and the dashboard rollup share. They must report
     * the *lead* hop — a copy for information is consulted, never in hand — and fall back to the
     * registering placement for rows with no hops at all, which is every document written before
     * migration `0005`.
     */
    it('resolves current custody from the lead hop, ignoring copies for information', async () => {
      const rows = await db
        .select({
          id: documents.id,
          divisionId: custodyDivisionId(),
          sectionId: custodySectionId(),
        })
        .from(documents);
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(FORWARDED)).toEqual({
        id: FORWARDED,
        divisionId: DIV_B,
        sectionId: SEC_B1,
      });
      // COPIED's newest hop is the Division C copy; custody is still the lead hop before it.
      expect(byId.get(COPIED)).toEqual({ id: COPIED, divisionId: DIV_B, sectionId: SEC_B1 });
      // DOC_A_CONFIDENTIAL has no route rows, so the registering placement is the only answer.
      expect(byId.get(DOC_A_CONFIDENTIAL)).toEqual({
        id: DOC_A_CONFIDENTIAL,
        divisionId: DIV_A,
        sectionId: SEC_A1,
      });
    });

    /*
     * A hop to a whole division has no section, and custody must then report none. `COALESCE`
     * would fall through to the registering section and claim the document sits in a section
     * nobody routed it to, which is why the section expression is a `CASE`.
     */
    it('reports no section when the lead hop names a division only', async () => {
      const divisionOnly = randomUUID();
      await db
        .insert(documents)
        .values(doc(divisionOnly, { divisionId: DIV_A, sectionId: SEC_A1 }));
      await db
        .insert(documentRoutes)
        .values({ documentId: divisionOnly, toDivisionId: DIV_C, routedById: CREATOR });
      const [row] = await db
        .select({ divisionId: custodyDivisionId(), sectionId: custodySectionId() })
        .from(documents)
        .where(eq(documents.id, divisionOnly));
      expect(row).toEqual({ divisionId: DIV_C, sectionId: null });
    });
  });

  /**
   * The two directions of the Reference Document relation, resolved through the same scope
   * predicate as everything else (decisions 165–166).
   *
   * Exercised through {@link DocumentsRepository} rather than by composing the predicate by hand,
   * because the thing under test is the *join*: the reference reads filter the document they point
   * at, not the link row, and a join written the other way round would return a link whose target
   * the reader may not open. The property this pins is that both directions are filtered by one
   * predicate — a reader who may see the letter but not the reply sees no reply, and the reverse.
   *
   * Declared last so its rows cannot disturb the suites above, which assert exact id lists over the
   * whole table.
   */
  describe('reference documents through scope', () => {
    const LETTER = randomUUID();
    const repository = new DocumentsRepository(db as unknown as Database);

    const referencedBy = async (a: AuthorizationActor): Promise<string[]> =>
      (await repository.listReferencedDocuments(a, LETTER)).map((entry) => entry.id).sort();

    beforeAll(async () => {
      // The outgoing letter sits in Division A, section A1, and answers three incoming documents:
      // one in that same section, one confidential one beside it, and one in Division B.
      await db
        .insert(documents)
        .values(
          doc(LETTER, { divisionId: DIV_A, sectionId: SEC_A1, direction: 'OUTGOING' as const }),
        );
      await db.insert(documentReferences).values(
        [DOC_A_SECTION, DOC_A_CONFIDENTIAL, DOC_B].map((incomingDocumentId) => ({
          outgoingDocumentId: LETTER,
          incomingDocumentId,
          createdById: CREATOR,
        })),
      );
    });

    it('shows each reader only the references they could open themselves', async () => {
      // Division A, section A1: the section document, but not the confidential row beside it and
      // not Division B's.
      expect(
        await referencedBy(actor({ role: 'STAFF_MEMBER', divisionId: DIV_A, sectionId: SEC_A1 })),
      ).toEqual([DOC_A_SECTION]);
      // Division B sees exactly the one it holds — a shorter list, from the other end.
      expect(
        await referencedBy(actor({ role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId: SEC_B1 })),
      ).toEqual([DOC_B]);
      // Cleared and office-wide: all three.
      expect(
        await referencedBy(actor({ role: 'ADMINISTRATOR', canAccessConfidential: true })),
      ).toEqual([DOC_A_SECTION, DOC_A_CONFIDENTIAL, DOC_B].sort());
    });

    /*
     * Different readers, different lengths, same document — stated as its own assertion because it
     * is the behaviour most likely to be "fixed" later by someone who reads it as a bug. Decision
     * 166 requires it: a reference the reader may not read is absent, not nulled and not counted,
     * so there is nothing in the payload from which the omission could be inferred.
     */
    it('leaves no placeholder behind for the entries it omits', async () => {
      const uncleared = await repository.listReferencedDocuments(
        actor({ role: 'STAFF_MEMBER', divisionId: DIV_A, sectionId: SEC_A1 }),
        LETTER,
      );
      expect(uncleared).toHaveLength(1);
      expect(uncleared.every((entry) => entry.id !== null && entry.trackingNumber !== null)).toBe(
        true,
      );
    });

    it('filters the reverse read by the same predicate as the forward one', async () => {
      // Division B holds DOC_B and may read it, but the letter answering it sits in a Division A
      // section: it may see the reply and not the letter, so its reply list is empty.
      expect(
        await repository.listReplyDocuments(
          actor({ role: 'STAFF_MEMBER', divisionId: DIV_B, sectionId: SEC_B1 }),
          DOC_B,
        ),
      ).toEqual([]);
      // Records staff read the whole office and see the inverse of the forward read.
      const replies = await repository.listReplyDocuments(
        actor({ role: 'RECORDS_STAFF' }),
        DOC_A_SECTION,
      );
      expect(replies.map((entry) => entry.id)).toEqual([LETTER]);
      expect(replies[0]).toMatchObject({ direction: 'OUTGOING' });
    });
  });
});
