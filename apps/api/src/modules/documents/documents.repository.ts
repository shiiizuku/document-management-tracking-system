import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
// `alias` is what lets one query join `divisions` and `users` twice — the hop's sender and its
// recipient, the officer who routed it and the one who accepted it.
import { alias } from 'drizzle-orm/pg-core';
import type { AuthorizationActor, RouteRecipient } from '../authorization/authorization.policy.js';
import {
  custodyDivisionId,
  custodySectionId,
  documentIsPending,
  documentScopeFor,
} from '../authorization/query-scope.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import {
  divisions,
  documentAssignments,
  documentMetadataRevisions,
  documentReferences,
  documentRoutes,
  documentSequences,
  documentShares,
  documents,
  referenceCounters,
  releaseEvents,
  sections,
  signatureEvents,
  users,
  workflowEvents,
} from '../../database/schema.js';
import { workflowStatuses, type ReleaseMethod } from '../workflow/workflow.service.js';
// The presented vocabulary, which includes the derived `PENDING` — what a filter accepts and a
// timeline row may carry. The engine's narrower stored set is a different type on purpose.
import type { WorkflowStatus } from '@dts/contracts';
import { ORD_DIVISION_CODE } from '../organization/organization.constants.js';

export type DocumentRow = typeof documents.$inferSelect;

/** One route row with its ids resolved, as the routing slip prints them. */
export interface RoutingSlipRoute {
  id: string;
  fromDivisionName: string | null;
  toDivisionName: string;
  toSectionName: string | null;
  routedByName: string;
  forInformation: boolean;
  remarks: string | null;
  acceptedAt: Date | null;
  acceptedByName: string | null;
  createdAt: Date;
}
export type WorkflowEventRow = typeof workflowEvents.$inferSelect;
export type DocumentRouteRow = typeof documentRoutes.$inferSelect;
export type SignatureEventRow = typeof signatureEvents.$inferSelect;
export type DocumentReferenceRow = typeof documentReferences.$inferSelect;

/** Either end of the Reference Document join, so the two directions can share one query builder. */
type DocumentReferenceEnd =
  typeof documentReferences.outgoingDocumentId | typeof documentReferences.incomingDocumentId;

/**
 * One end of a Reference Document link, as both directions present it (decision 165).
 *
 * A summary rather than the whole row because the list is a right-rail index into other records,
 * not a payload to work from: the reader opens the referenced document through
 * `/documents/:id`, which scopes it again. Hand-built for the same reason `PublicDocument` is —
 * a column added later is never served by accident.
 */
export interface ReferenceDocumentSummary {
  id: string;
  trackingNumber: string;
  title: string;
  direction: DocumentRow['direction'];
  status: DocumentRow['status'];
  createdAt: Date;
}

/** The membership and custody facts the in-memory authorization policy reads. */
export interface DocumentAuthorizationFacts {
  routes: RouteRecipient[];
  assigneeUserIds: string[];
  sharedUserIds: string[];
}

export type NewDocument = typeof documents.$inferInsert;

/** Status totals for the dashboard tiles. */
export interface DashboardCounts {
  total: number;
  /*
   * Keyed by the *presented* vocabulary, so `PENDING` has a tile. It is counted from the route
   * rows rather than the status column, and it overlaps the other counts rather than partitioning
   * them — a pending document also has a lifecycle status. `total` is the document count.
   */
  byStatus: Record<WorkflowStatus, number>;
  overdue: number;
}

/** Work waiting to be accepted, broken down by the division holding it. */
export interface DashboardDivisionPending {
  divisionId: string;
  divisionName: string;
  total: number;
}

/** One entry in the scoped recent-activity feed. */
export interface DashboardActivityEntry {
  id: string;
  documentId: string;
  trackingNumber: string;
  title: string;
  action: string;
  /** The vocabulary in force when the event happened, not the column's — see `TimelineEntry`. */
  fromStatus: WorkflowStatus | null;
  toStatus: WorkflowStatus;
  actorId: string;
  actorName: string;
  occurredAt: Date;
}

/** The columns a metadata edit is allowed to touch (see `updateDocumentMetadataSchema`). */
export interface DocumentMetadataPatch {
  title?: string;
  type?: string;
  description?: string | null;
  priority?: DocumentRow['priority'];
  sender?: string | null;
  company?: string | null;
  referenceNumber?: string | null;
  email?: string | null;
  confidential?: boolean;
  dueAt?: Date | null;
}

/** The columns a workflow transition writes back onto the document row. */
export interface DocumentActionPatch {
  status: DocumentRow['status'];
  signedFileVersionId?: string | null;
}

export interface DocumentSearchFilters {
  search?: string | undefined;
  /*
   * The presented vocabulary, not the column's: `PENDING` is a filter users apply and a status they
   * read off a badge, even though the column holds no such value — see `search`, which resolves it
   * to the derived unaccepted-route predicate.
   */
  status?: WorkflowStatus | undefined;
  priority?: DocumentRow['priority'] | undefined;
  type?: string | undefined;
  direction?: DocumentRow['direction'] | undefined;
  divisionId?: string | undefined;
  sectionId?: string | undefined;
  sort?: 'createdAt' | 'priority' | 'status' | undefined;
  order?: 'asc' | 'desc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

export interface DocumentSearchPage {
  items: DocumentRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface NewWorkflowEvent {
  documentId: string;
  sequence: number;
  actorId: string;
  action: string;
  fromStatus: DocumentRow['status'];
  toStatus: DocumentRow['status'];
  remarks: string | null;
}

export interface NewAssignment {
  documentId: string;
  userId: string;
  assignedById: string;
}

/**
 * The outcome of validating where a document is being registered. `divisionCode` is carried
 * out so the create use case can format an outgoing reference number without a second lookup.
 */
export type PlacementResult = { ok: true; divisionCode: string } | { ok: false; reason: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;

/**
 * The Postgres home of the document aggregate: the `documents` row plus its metadata
 * revisions, workflow timeline and assignments, and the two number allocators
 * (`document_sequences` for tracking, `reference_counters` for outgoing references).
 *
 * Reads that list, count or fetch a document for a specific actor go through
 * {@link documentScopeFor} so a row the actor may not see is never returned — scope is part of
 * the SQL, never a post-filter (decision register 90). Writes take an optional executor so a
 * use case can compose several of them into one transaction.
 */
@Injectable()
export class DocumentsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(
    values: NewDocument,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow> {
    const [row] = await executor.insert(documents).values(values).returning();
    if (!row) throw new Error('Insert of a document returned no row');
    return row;
  }

  /** Unscoped fetch of a live (not soft-deleted) document. */
  async findById(id: string): Promise<DocumentRow | null> {
    const [row] = await this.database
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)));
    return row ?? null;
  }

  /**
   * Unscoped fetch of a document that may be soft-deleted. Only the restore path uses it — every
   * other read excludes `deleted_at IS NOT NULL` — so a deleted row can still be found to bring
   * it back, while staying invisible to list/search/detail.
   */
  async findByIdIncludingDeleted(id: string): Promise<DocumentRow | null> {
    const [row] = await this.database.select().from(documents).where(eq(documents.id, id));
    return row ?? null;
  }

  /**
   * Fetch a live document only if `actor` may read it. Composing the scope predicate here
   * means a guessed id an actor cannot reach comes back as `null` — indistinguishable from an
   * id that does not exist — so the service can report both as a 404.
   */
  async findReadableById(actor: AuthorizationActor, id: string): Promise<DocumentRow | null> {
    const [row] = await this.database
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt), documentScopeFor(actor)));
    return row ?? null;
  }

  /**
   * Allocates the next office-wide tracking sequence. A tracking number only has to be unique
   * (gaps from rolled-back creates are fine), so a single counter row incremented in one
   * statement is enough and never lets two concurrent creates read the same value.
   */
  async allocateTracking(executor: DatabaseExecutor = this.database): Promise<number> {
    const [row] = await executor
      .insert(documentSequences)
      .values({ scope: 'TRACKING', value: 1 })
      .onConflictDoUpdate({
        target: documentSequences.scope,
        set: { value: sql`${documentSequences.value} + 1` },
      })
      .returning({ value: documentSequences.value });
    if (!row) throw new Error('Tracking-number allocation returned no row');
    return row.value;
  }

  /**
   * Allocates the next outgoing reference number for a division and year. The `ON CONFLICT DO
   * UPDATE` locks the counter row, so N concurrent outgoing creates serialize into N distinct
   * consecutive values; run inside the create transaction, a rolled-back create gives its
   * number back rather than leaving a hole.
   */
  async allocateReference(
    divisionId: string,
    year: number,
    executor: DatabaseExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor
      .insert(referenceCounters)
      .values({ divisionId, year, value: 1 })
      .onConflictDoUpdate({
        target: [referenceCounters.divisionId, referenceCounters.year],
        set: { value: sql`${referenceCounters.value} + 1` },
      })
      .returning({ value: referenceCounters.value });
    if (!row) throw new Error('Reference-number allocation returned no row');
    return row.value;
  }

  /**
   * Validates that a document may be registered under `divisionId`/`sectionId`: both rows
   * exist, are active, and the section belongs to the division. The uuid guard is what keeps a
   * malformed id (the create schema accepts any non-empty string) from reaching Postgres as an
   * invalid-uuid cast error — it is reported as "does not exist" instead.
   */
  async resolvePlacement(divisionId: string, sectionId: string | null): Promise<PlacementResult> {
    if (!UUID_PATTERN.test(divisionId))
      return { ok: false, reason: 'The requested division does not exist' };
    const [division] = await this.database
      .select({ code: divisions.code, active: divisions.active })
      .from(divisions)
      .where(eq(divisions.id, divisionId));
    if (division === undefined || !division.active)
      return { ok: false, reason: 'The requested division does not exist or is inactive' };

    if (sectionId !== null) {
      if (!UUID_PATTERN.test(sectionId))
        return { ok: false, reason: 'The requested section does not exist' };
      const [section] = await this.database
        .select({ active: sections.active, divisionId: sections.divisionId })
        .from(sections)
        .where(eq(sections.id, sectionId));
      if (section === undefined || !section.active)
        return { ok: false, reason: 'The requested section does not exist or is inactive' };
      if (section.divisionId !== divisionId)
        return { ok: false, reason: 'The requested section belongs to a different division' };
    }
    return { ok: true, divisionCode: division.code };
  }

  async search(
    actor: AuthorizationActor,
    filters: DocumentSearchFilters,
  ): Promise<DocumentSearchPage> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, filters.pageSize ?? DEFAULT_PAGE_SIZE));

    const conditions: SQL[] = [isNull(documents.deletedAt), documentScopeFor(actor)];
    const search = filters.search?.trim();
    if (search) {
      const pattern = `%${search}%`;
      const matches = or(
        ilike(documents.title, pattern),
        ilike(documents.trackingNumber, pattern),
        ilike(documents.referenceNumber, pattern),
        ilike(documents.sender, pattern),
        ilike(documents.company, pattern),
      );
      if (matches) conditions.push(matches);
    }
    /*
     * `PENDING` is not a value this column can hold — it is the existence of an unaccepted route
     * (ADR-0005) — so the one filter users think of as a status resolves to a different predicate
     * entirely. Both go through `documentIsPending` so the registry, the dashboard and the reports
     * cannot each decide for themselves what pending means.
     */
    if (filters.status === 'PENDING') conditions.push(documentIsPending());
    else if (filters.status) conditions.push(eq(documents.status, filters.status));
    if (filters.priority) conditions.push(eq(documents.priority, filters.priority));
    if (filters.type) conditions.push(eq(documents.type, filters.type));
    if (filters.direction) conditions.push(eq(documents.direction, filters.direction));
    /*
     * Where the document *is*, not where it was filed. `documents.division_id` stopped moving when
     * routing became non-destructive (ADR-0005), so filtering on it would answer "registered by",
     * which for incoming correspondence is the ORD every time.
     *
     * It is also what keeps the dashboard's division chart clickable. That chart groups pending
     * work by custody, and `dashboard.int.test.ts` asserts each tile equals what this list returns
     * for the same division as the same user — one of them filtering on origin and the other
     * grouping by custody would make the two disagree the first time anything was forwarded.
     */
    if (filters.divisionId) conditions.push(eq(custodyDivisionId(), filters.divisionId));
    if (filters.sectionId) conditions.push(eq(custodySectionId(), filters.sectionId));
    const where = and(...conditions);

    // The enum columns are declared LOW→URGENT and IN_PROCESS→ARCHIVED, so Postgres orders them
    // by the same rank the in-memory search used. `id` is the deterministic tiebreak that
    // keeps pagination stable across pages when the sort key ties.
    const direction = filters.order === 'asc' ? asc : desc;
    const sortColumn =
      filters.sort === 'priority'
        ? documents.priority
        : filters.sort === 'status'
          ? documents.status
          : documents.createdAt;

    const [{ total } = { total: 0 }] = await this.database
      .select({ total: count() })
      .from(documents)
      .where(where);

    const items = await this.database
      .select()
      .from(documents)
      .where(where)
      .orderBy(direction(sortColumn), direction(documents.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    return { items, total, page, pageSize };
  }

  /**
   * Applies a metadata patch under optimistic concurrency: the row is updated only if its
   * `version` still matches what the editor read. A mismatch returns `null`, which the service
   * turns into a 409, so a stale edit never silently clobbers a newer one. The version is
   * bumped so a subsequent stale write also conflicts.
   */
  async updateMetadata(
    id: string,
    expectedVersion: number,
    patch: DocumentMetadataPatch,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ ...patch, version: sql`${documents.version} + 1` })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.version, expectedVersion),
          isNull(documents.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Persists a workflow transition on the row under the same optimistic-version guard. */
  async updateForAction(
    id: string,
    expectedVersion: number,
    patch: DocumentActionPatch,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ ...patch, version: sql`${documents.version} + 1` })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.version, expectedVersion),
          isNull(documents.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /**
   * Logically deletes a live document under the same optimistic-version guard as the other
   * mutations: it stamps `deleted_at` only if the row still matches `expectedVersion` and is not
   * already deleted, and bumps `version`. A mismatch (stale, missing, or already deleted) returns
   * `null`, which the service turns into a 409.
   */
  async softDelete(
    id: string,
    expectedVersion: number,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ deletedAt: new Date(), version: sql`${documents.version} + 1` })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.version, expectedVersion),
          isNull(documents.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Reverses {@link softDelete}: clears `deleted_at` only if the row *is* currently deleted. */
  async restore(
    id: string,
    expectedVersion: number,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ deletedAt: null, version: sql`${documents.version} + 1` })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.version, expectedVersion),
          isNotNull(documents.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async insertMetadataRevision(
    revision: {
      documentId: string;
      actorId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
    },
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.insert(documentMetadataRevisions).values(revision);
  }

  async listMetadataRevisions(
    documentId: string,
  ): Promise<(typeof documentMetadataRevisions.$inferSelect)[]> {
    return this.database
      .select()
      .from(documentMetadataRevisions)
      .where(eq(documentMetadataRevisions.documentId, documentId))
      .orderBy(asc(documentMetadataRevisions.occurredAt));
  }

  /** The next 1-based position in a document's timeline; the unique index rejects a duplicate. */
  async nextWorkflowSequence(
    documentId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<number> {
    const [row] = await executor
      .select({ max: sql<number>`coalesce(max(${workflowEvents.sequence}), 0)` })
      .from(workflowEvents)
      .where(eq(workflowEvents.documentId, documentId));
    return (row?.max ?? 0) + 1;
  }

  async insertWorkflowEvent(
    event: NewWorkflowEvent,
    executor: DatabaseExecutor = this.database,
  ): Promise<WorkflowEventRow> {
    const [row] = await executor.insert(workflowEvents).values(event).returning();
    if (!row) throw new Error('Insert of a workflow event returned no row');
    return row;
  }

  /**
   * The routing slip's rows, with every id already resolved to the name the form prints.
   *
   * One query with the joins in it, not a loop of lookups and not a client-side join: the PDF is
   * rendered in the API, so the names have to be here, and a slip for a document with a dozen hops
   * would otherwise be a dozen round trips to the organization tables.
   *
   * Ordered by `created_at`, which is the order the hops happened and therefore the order the
   * paper form is filled in down the page. For-information rows come back too — the caller needs
   * them to print the copied-to line against the hop that consulted them (decision 160) — and are
   * marked rather than filtered here, because a repository that silently dropped rows would make
   * "one row per hop" a fact nothing tests.
   */
  async routingSlipRoutes(documentId: string): Promise<RoutingSlipRoute[]> {
    const fromDivisions = alias(divisions, 'from_divisions');
    const acceptedBy = alias(users, 'accepted_by');

    const rows = await this.database
      .select({
        id: documentRoutes.id,
        fromDivisionName: fromDivisions.name,
        toDivisionName: divisions.name,
        toSectionName: sections.name,
        routedByName: users.displayName,
        forInformation: documentRoutes.forInformation,
        remarks: documentRoutes.remarks,
        acceptedAt: documentRoutes.acceptedAt,
        acceptedByName: acceptedBy.displayName,
        createdAt: documentRoutes.createdAt,
      })
      .from(documentRoutes)
      .innerJoin(divisions, eq(divisions.id, documentRoutes.toDivisionId))
      .leftJoin(fromDivisions, eq(fromDivisions.id, documentRoutes.fromDivisionId))
      .leftJoin(sections, eq(sections.id, documentRoutes.toSectionId))
      .innerJoin(users, eq(users.id, documentRoutes.routedById))
      .leftJoin(acceptedBy, eq(acceptedBy.id, documentRoutes.acceptedById))
      .where(eq(documentRoutes.documentId, documentId))
      .orderBy(asc(documentRoutes.createdAt));

    return rows;
  }

  /** The name of one division, for the slip's header rows. */
  async divisionName(divisionId: string): Promise<string | null> {
    const [row] = await this.database
      .select({ name: divisions.name })
      .from(divisions)
      .where(eq(divisions.id, divisionId))
      .limit(1);
    return row?.name ?? null;
  }

  async listTimeline(documentId: string): Promise<WorkflowEventRow[]> {
    return this.database
      .select()
      .from(workflowEvents)
      .where(eq(workflowEvents.documentId, documentId))
      .orderBy(asc(workflowEvents.sequence));
  }

  /** Adds an assignment if the recipient does not already hold an active one (idempotent). */
  async insertAssignment(
    assignment: NewAssignment,
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.insert(documentAssignments).values({ ...assignment, active: true });
  }

  async hasActiveAssignment(
    documentId: string,
    userId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<boolean> {
    const [row] = await executor
      .select({ id: documentAssignments.id })
      .from(documentAssignments)
      .where(
        and(
          eq(documentAssignments.documentId, documentId),
          eq(documentAssignments.userId, userId),
          eq(documentAssignments.active, true),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async listActiveAssigneeIds(documentId: string): Promise<string[]> {
    const rows = await this.database
      .select({ userId: documentAssignments.userId })
      .from(documentAssignments)
      .where(
        and(eq(documentAssignments.documentId, documentId), eq(documentAssignments.active, true)),
      );
    return rows.map((row) => row.userId).filter((userId): userId is string => userId !== null);
  }

  /**
   * Everything `AuthorizationPolicy.can` needs about a set of documents, in three queries.
   *
   * It exists because the in-memory policy is re-run on the capability path after SQL scope has
   * already settled readability, and since ADR-0005 that second pass needs the custody hops: a
   * resource built without them denies the very unit the document was forwarded to. Batched over
   * ids rather than offered per document so `deletedQueue` — the one caller with N rows — cannot
   * quietly become N round trips.
   */
  async authorizationFacts(
    documentIds: readonly string[],
  ): Promise<Map<string, DocumentAuthorizationFacts>> {
    const facts = new Map<string, DocumentAuthorizationFacts>(
      documentIds.map((id) => [id, { routes: [], assigneeUserIds: [], sharedUserIds: [] }]),
    );
    if (documentIds.length === 0) return facts;
    const ids = [...documentIds];

    const [routeRows, assignmentRows, shareRows] = await Promise.all([
      this.database
        .select({
          documentId: documentRoutes.documentId,
          toDivisionId: documentRoutes.toDivisionId,
          toSectionId: documentRoutes.toSectionId,
          forInformation: documentRoutes.forInformation,
        })
        .from(documentRoutes)
        .where(inArray(documentRoutes.documentId, ids)),
      this.database
        .select({
          documentId: documentAssignments.documentId,
          userId: documentAssignments.userId,
        })
        .from(documentAssignments)
        .where(
          and(inArray(documentAssignments.documentId, ids), eq(documentAssignments.active, true)),
        ),
      this.database
        .select({ documentId: documentShares.documentId, userId: documentShares.userId })
        .from(documentShares)
        .where(inArray(documentShares.documentId, ids)),
    ]);

    for (const row of routeRows) {
      facts.get(row.documentId)?.routes.push({
        toDivisionId: row.toDivisionId,
        toSectionId: row.toSectionId,
        forInformation: row.forInformation,
      });
    }
    for (const row of assignmentRows) {
      if (row.userId !== null) facts.get(row.documentId)?.assigneeUserIds.push(row.userId);
    }
    for (const row of shareRows) {
      facts.get(row.documentId)?.sharedUserIds.push(row.userId);
    }
    return facts;
  }

  /** Live documents a user currently holds an active assignment on — their work queue. */
  async listAssignedTo(userId: string): Promise<DocumentRow[]> {
    return this.database
      .select({ document: documents })
      .from(documents)
      .innerJoin(documentAssignments, eq(documentAssignments.documentId, documents.id))
      .where(
        and(
          eq(documentAssignments.userId, userId),
          eq(documentAssignments.active, true),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(desc(documents.createdAt))
      .then((rows) => rows.map((row) => row.document));
  }

  /**
   * Soft-deleted documents still inside the caller's scope, newest deletion first.
   *
   * Restoring a document needs its id *and* its current version, and a deleted row is invisible to
   * every other read path — so without this list the restore endpoint is only reachable by someone
   * who kept a URL and guessed a version number. Scoped by the same `documentScopeFor` predicate
   * as the registry, because the deleted-items view must not widen what anyone can see.
   */
  async listDeleted(actor: AuthorizationActor): Promise<DocumentRow[]> {
    return this.database
      .select()
      .from(documents)
      .where(and(isNotNull(documents.deletedAt), documentScopeFor(actor)))
      .orderBy(desc(documents.deletedAt), desc(documents.id));
  }

  /**
   * Takes the optimistic-version guard without changing anything else.
   *
   * This was `relocate`, which wrote `division_id` / `section_id` and so made forwarding
   * destructive: a document could only ever be *handed over*, never copied in, and the division it
   * came from lost it. ADR-0005 ends that — custody lives on `document_routes` and the columns
   * record where the document was registered — leaving this with only the job it always also had,
   * which is to stop two concurrent forwards both succeeding.
   */
  async bumpVersion(
    id: string,
    expectedVersion: number,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ version: sql`${documents.version} + 1` })
      .where(
        and(
          eq(documents.id, id),
          eq(documents.version, expectedVersion),
          isNull(documents.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  async insertRoute(
    route: {
      documentId: string;
      fromDivisionId: string | null;
      toDivisionId: string;
      toSectionId: string | null;
      routedById: string;
      remarks: string | null;
      forInformation?: boolean;
    },
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.insert(documentRoutes).values(route);
  }

  /**
   * Stamps a recipient's acceptance on one route row.
   *
   * The `accepted_at IS NULL` predicate is the concurrency control, the same shape
   * `AccountRequestsRepository.close` uses: two recipients pressing Accept at once means one
   * `UPDATE` matches and the other returns no row, so a double acceptance cannot overwrite the
   * first received timestamp — which is evidence printed on the slip, not a cache.
   */
  async acceptRoute(
    routeId: string,
    acceptedById: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRouteRow | null> {
    const [row] = await executor
      .update(documentRoutes)
      .set({ acceptedAt: new Date(), acceptedById })
      .where(and(eq(documentRoutes.id, routeId), isNull(documentRoutes.acceptedAt)))
      .returning();
    return row ?? null;
  }

  async listRoutes(documentId: string): Promise<DocumentRouteRow[]> {
    return this.database
      .select()
      .from(documentRoutes)
      .where(eq(documentRoutes.documentId, documentId))
      .orderBy(asc(documentRoutes.createdAt));
  }

  /**
   * Whether a division is the Office of the Regional Director, by code.
   *
   * The workflow needs this to decide whether an outgoing draft requires a division head's
   * initial: the ORD's head is the Director, so requiring one there would have the same person
   * initial and sign (ADR-0007).
   */
  async isOrdDivision(divisionId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ code: divisions.code })
      .from(divisions)
      .where(eq(divisions.id, divisionId));
    return row?.code === ORD_DIVISION_CODE;
  }

  async insertSignatureEvent(
    signature: { documentId: string; fileVersionId: string; signerId: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.insert(signatureEvents).values(signature);
  }

  async listSignatures(documentId: string): Promise<SignatureEventRow[]> {
    return this.database
      .select()
      .from(signatureEvents)
      .where(eq(signatureEvents.documentId, documentId))
      .orderBy(asc(signatureEvents.signedAt));
  }

  /**
   * Links an incoming document to an outgoing one, returning the new row's id — or `null` when the
   * pair was already linked.
   *
   * `ON CONFLICT DO NOTHING` against the unique pair is what makes linking idempotent without a
   * read-before-write, and the returned id is what tells the caller whether anything actually
   * happened: a repeat submit writes no row, so it also writes no second audit event and no second
   * outbox row (decision 179). Neither the direction rule nor the readability of the target is
   * checked here — both live in the service, where the readability miss can be answered as the
   * same 404 an absent document gets (decision 166).
   */
  async insertReference(
    reference: { outgoingDocumentId: string; incomingDocumentId: string; createdById: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<string | null> {
    const [row] = await executor
      .insert(documentReferences)
      .values(reference)
      .onConflictDoNothing({
        target: [documentReferences.outgoingDocumentId, documentReferences.incomingDocumentId],
      })
      .returning({ id: documentReferences.id });
    return row?.id ?? null;
  }

  /**
   * Removes one link, but only if the actor may read the document it points at. Returns the id of
   * the row that was deleted, or `null` when nothing matched.
   *
   * The readability test is **part of the `DELETE`**, not a lookup followed by a permission check:
   * under decision 166, unlinking a reference whose target the actor cannot read has to be
   * indistinguishable from unlinking one that was never there, and a two-step version answers
   * "that link is real and you may not touch it" with a different status or message. One statement,
   * one zero-row outcome, one 404.
   */
  async deleteReference(
    actor: AuthorizationActor,
    outgoingDocumentId: string,
    incomingDocumentId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<string | null> {
    const [row] = await executor
      .delete(documentReferences)
      .where(
        and(
          eq(documentReferences.outgoingDocumentId, outgoingDocumentId),
          eq(documentReferences.incomingDocumentId, incomingDocumentId),
          this.referenceTargetIsReadable(actor, documentReferences.incomingDocumentId),
        ),
      )
      .returning({ id: documentReferences.id });
    return row?.id ?? null;
  }

  /**
   * The incoming documents an outgoing document names, filtered by the reader's own scope.
   *
   * One scoped query, joined rather than a loop of {@link findReadableById}: the round trips are
   * the lesser reason, and the real one is that a loop invites a `null` placeholder for the
   * entries the reader cannot see, which is exactly the leak decision 166 forbids. **A reference
   * the reader cannot read is absent — not nulled, not counted.** Two readers seeing different
   * lengths for the same document is the intended behaviour and not a bug to reconcile.
   */
  async listReferencedDocuments(
    actor: AuthorizationActor,
    outgoingDocumentId: string,
  ): Promise<ReferenceDocumentSummary[]> {
    return this.referenceSummaries(
      actor,
      documentReferences.outgoingDocumentId,
      outgoingDocumentId,
      documentReferences.incomingDocumentId,
    );
  }

  /**
   * The inverse read: the outgoing documents that name this incoming one as a reference, which the
   * incoming side presents as its replies (decision 165). Scoped exactly as
   * {@link listReferencedDocuments} is, so a reader who may see the reply but not the letter — or
   * the letter but not the reply — simply sees a shorter list.
   */
  async listReplyDocuments(
    actor: AuthorizationActor,
    incomingDocumentId: string,
  ): Promise<ReferenceDocumentSummary[]> {
    return this.referenceSummaries(
      actor,
      documentReferences.incomingDocumentId,
      incomingDocumentId,
      documentReferences.outgoingDocumentId,
    );
  }

  /**
   * Both directions of the reference read, which differ only in which column is matched and which
   * is joined. Written once so the two can never be scoped differently — the pair of them being
   * filtered by the same predicate is the property `query-scope.int.test.ts` pins.
   */
  private async referenceSummaries(
    actor: AuthorizationActor,
    matchColumn: DocumentReferenceEnd,
    matchValue: string,
    joinColumn: DocumentReferenceEnd,
  ): Promise<ReferenceDocumentSummary[]> {
    return this.database
      .select({
        id: documents.id,
        trackingNumber: documents.trackingNumber,
        title: documents.title,
        direction: documents.direction,
        status: documents.status,
        createdAt: documents.createdAt,
      })
      .from(documentReferences)
      .innerJoin(documents, eq(documents.id, joinColumn))
      .where(and(eq(matchColumn, matchValue), isNull(documents.deletedAt), documentScopeFor(actor)))
      .orderBy(asc(documentReferences.createdAt));
  }

  /**
   * Whether the actor may read the document a reference column points at, as a correlated
   * `EXISTS`. `documents` appears in this subquery's own `FROM`, so the scope predicate's
   * references to it bind here rather than to any outer query — which is what lets the same
   * `documentScopeFor` be reused inside a statement against `document_references`.
   */
  private referenceTargetIsReadable(actor: AuthorizationActor, column: DocumentReferenceEnd): SQL {
    return exists(
      sql`(select 1 from ${documents}
           where ${documents.id} = ${column}
             and ${documents.deletedAt} is null
             and ${documentScopeFor(actor)})`,
    );
  }

  /** Grants a user read access. Idempotent: a repeat share for the same user is a no-op. */
  async insertShare(
    share: { documentId: string; userId: string; sharedById: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor
      .insert(documentShares)
      .values(share)
      .onConflictDoNothing({ target: [documentShares.documentId, documentShares.userId] });
  }

  async listSharedUserIds(documentId: string): Promise<string[]> {
    const rows = await this.database
      .select({ userId: documentShares.userId })
      .from(documentShares)
      .where(eq(documentShares.documentId, documentId));
    return rows.map((row) => row.userId);
  }

  /**
   * Points a document at its newest attachment version and bumps the row version so that
   * signing a document whose evidence changed underneath conflicts. Applies to the live row
   * unconditionally (no optimistic check — an upload is not an edit of a prior version).
   */
  async setCurrentFileVersion(
    documentId: string,
    versionId: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ currentFileVersionId: versionId, version: sql`${documents.version} + 1` })
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .returning();
    return row ?? null;
  }

  async insertReleaseEvent(
    event: { documentId: string; releasedById: string; method: ReleaseMethod },
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.insert(releaseEvents).values(event);
  }

  async findReleaseMethod(documentId: string): Promise<ReleaseMethod | null> {
    const [row] = await this.database
      .select({ method: releaseEvents.method })
      .from(releaseEvents)
      .where(eq(releaseEvents.documentId, documentId));
    return row?.method ?? null;
  }

  /**
   * Scope-aware dashboard rollup: totals per workflow status and the overdue count, computed
   * from the same `documentScopeFor` predicate the list uses so the dashboard can never show a
   * number the list can't back up (decision register 90 — one source of truth for scope).
   */
  /**
   * One division's share of the work waiting to be accepted.
   *
   * Grouped by **current custody**, not by `documents.division_id`. That column is the registering
   * placement and never moves (ADR-0005), so grouping on it would attribute every piece of incoming
   * correspondence to the ORD that registered it — turning the one tile whose job is "who is
   * sitting on work" into a count of who filed it.
   *
   * `custodyDivisionId` is the same expression the registry's division filter uses, which is what
   * makes a tile clickable rather than decorative: the chart and the list it links to are then the
   * same question asked twice, and `dashboard.int.test.ts` holds them to it.
   */
  async pendingByDivision(actor: AuthorizationActor): Promise<DashboardDivisionPending[]> {
    const custodyDivision = custodyDivisionId();
    const rows = await this.database
      .select({
        divisionId: custodyDivision,
        divisionName: divisions.name,
        total: count(),
      })
      .from(documents)
      .innerJoin(divisions, eq(divisions.id, custodyDivision))
      .where(and(isNull(documents.deletedAt), documentScopeFor(actor), documentIsPending()))
      .groupBy(custodyDivision, divisions.name)
      .orderBy(desc(count()), asc(divisions.name));
    return rows.map((row) => ({
      divisionId: row.divisionId,
      divisionName: row.divisionName,
      total: row.total,
    }));
  }

  /**
   * The most recent workflow actions on documents this actor may read.
   *
   * Scoped through the same predicate as every list, so the feed can never name a document the
   * actor could not have opened. Remarks are deliberately omitted: the feed exists to say that
   * something moved and to link to it, and the full text already lives on the document's own
   * timeline, behind the read check that this join only approximates at the row level.
   */
  async recentActivity(
    actor: AuthorizationActor,
    limit: number,
  ): Promise<DashboardActivityEntry[]> {
    const rows = await this.database
      .select({
        id: workflowEvents.id,
        documentId: workflowEvents.documentId,
        trackingNumber: documents.trackingNumber,
        title: documents.title,
        action: workflowEvents.action,
        fromStatus: workflowEvents.fromStatus,
        toStatus: workflowEvents.toStatus,
        actorId: workflowEvents.actorId,
        actorName: users.displayName,
        occurredAt: workflowEvents.occurredAt,
      })
      .from(workflowEvents)
      .innerJoin(documents, eq(documents.id, workflowEvents.documentId))
      .innerJoin(users, eq(users.id, workflowEvents.actorId))
      .where(and(isNull(documents.deletedAt), documentScopeFor(actor)))
      .orderBy(desc(workflowEvents.occurredAt))
      .limit(limit);

    /*
     * The events table keeps the status vocabulary that was in force when each row was written — a
     * hop recorded before the 2026-10-02 revision truthfully says `PENDING`. Narrowed here rather
     * than in the projection: the presented vocabulary is the wider of the two, and every name
     * these columns can hold is a member of it.
     */
    return rows.map((row) => ({
      ...row,
      fromStatus: row.fromStatus as WorkflowStatus | null,
      toStatus: row.toStatus as WorkflowStatus,
    }));
  }

  async summary(actor: AuthorizationActor): Promise<DashboardCounts> {
    const scoped = and(isNull(documents.deletedAt), documentScopeFor(actor));
    const statusRows = await this.database
      .select({ status: documents.status, total: count() })
      .from(documents)
      .where(scoped)
      .groupBy(documents.status);
    const [overdueRow] = await this.database
      .select({ total: count() })
      .from(documents)
      .where(
        and(
          scoped,
          notInArray(documents.status, ['RELEASED', 'ARCHIVED']),
          sql`${documents.dueAt} is not null and ${documents.dueAt} < now()`,
        ),
      );
    /*
     * `PENDING` is a tile on this dashboard and a filter in the registry, but it is not a value the
     * status column holds — so it is counted separately, by the same `documentIsPending` predicate
     * the registry filter uses (ADR-0005). Deliberately *not* folded into `total`: the pending
     * documents are already counted under whatever lifecycle status they carry, and adding them
     * again would make the tiles sum to more than the number of documents.
     */
    const [pendingRow] = await this.database
      .select({ total: count() })
      .from(documents)
      .where(and(scoped, documentIsPending()));

    const byStatus = Object.fromEntries(
      [...workflowStatuses, 'PENDING' as const].map((status) => [status, 0]),
    ) as Record<WorkflowStatus, number>;
    let total = 0;
    for (const row of statusRows) {
      byStatus[row.status] = row.total;
      total += row.total;
    }
    byStatus.PENDING = pendingRow?.total ?? 0;
    return { total, byStatus, overdue: overdueRow?.total ?? 0 };
  }

  /** Scoped list of live documents registered within a calendar month, for the monthly report. */
  async listForReport(
    actor: AuthorizationActor,
    year: number,
    month: number,
  ): Promise<DocumentRow[]> {
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    return this.database
      .select()
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          documentScopeFor(actor),
          sql`${documents.createdAt} >= ${start} and ${documents.createdAt} < ${end}`,
        ),
      )
      .orderBy(asc(documents.createdAt));
  }
}
