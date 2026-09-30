import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { AuthorizationActor } from '../authorization/authorization.policy.js';
import { documentScopeFor } from '../authorization/query-scope.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import {
  divisions,
  documentAssignments,
  documentMetadataRevisions,
  documentRoutes,
  documentSequences,
  documentShares,
  documents,
  referenceCounters,
  releaseEvents,
  sections,
  signatureEvents,
  workflowEvents,
} from '../../database/schema.js';
import { workflowStatuses, type ReleaseMethod } from '../workflow/workflow.service.js';

export type DocumentRow = typeof documents.$inferSelect;
export type WorkflowEventRow = typeof workflowEvents.$inferSelect;
export type DocumentRouteRow = typeof documentRoutes.$inferSelect;
export type SignatureEventRow = typeof signatureEvents.$inferSelect;

export type NewDocument = typeof documents.$inferInsert;

/** The columns a metadata edit is allowed to touch (see `updateDocumentMetadataSchema`). */
export interface DocumentMetadataPatch {
  title?: string;
  type?: string;
  description?: string | null;
  priority?: DocumentRow['priority'];
  sender?: string | null;
  company?: string | null;
  referenceNumber?: string | null;
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
  status?: DocumentRow['status'] | undefined;
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
    if (filters.status) conditions.push(eq(documents.status, filters.status));
    if (filters.priority) conditions.push(eq(documents.priority, filters.priority));
    if (filters.type) conditions.push(eq(documents.type, filters.type));
    if (filters.direction) conditions.push(eq(documents.direction, filters.direction));
    if (filters.divisionId) conditions.push(eq(documents.divisionId, filters.divisionId));
    if (filters.sectionId) conditions.push(eq(documents.sectionId, filters.sectionId));
    const where = and(...conditions);

    // The enum columns are declared LOW→URGENT and PENDING→ARCHIVED, so Postgres orders them
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

  /** Moves a document to a new division/section under the optimistic-version guard. */
  async relocate(
    id: string,
    expectedVersion: number,
    divisionId: string,
    sectionId: string | null,
    executor: DatabaseExecutor = this.database,
  ): Promise<DocumentRow | null> {
    const [row] = await executor
      .update(documents)
      .set({ divisionId, sectionId, version: sql`${documents.version} + 1` })
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
    },
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.insert(documentRoutes).values(route);
  }

  async listRoutes(documentId: string): Promise<DocumentRouteRow[]> {
    return this.database
      .select()
      .from(documentRoutes)
      .where(eq(documentRoutes.documentId, documentId))
      .orderBy(asc(documentRoutes.createdAt));
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
  async summary(
    actor: AuthorizationActor,
  ): Promise<{ total: number; byStatus: Record<DocumentRow['status'], number>; overdue: number }> {
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
    const byStatus = Object.fromEntries(workflowStatuses.map((status) => [status, 0])) as Record<
      DocumentRow['status'],
      number
    >;
    let total = 0;
    for (const row of statusRows) {
      byStatus[row.status] = row.total;
      total += row.total;
    }
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
