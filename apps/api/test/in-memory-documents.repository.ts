import { randomUUID } from 'node:crypto';
import type { AuthorizationActor } from '../src/modules/authorization/authorization.policy.js';
import { AuthorizationPolicy } from '../src/modules/authorization/authorization.policy.js';
import {
  DocumentSearchService,
  type DocumentSearchQuery,
  type SearchableDocument,
} from '../src/modules/documents/document-search.service.js';
import type {
  DocumentActionPatch,
  DocumentAuthorizationFacts,
  DocumentMetadataPatch,
  DocumentRouteRow,
  DocumentRow,
  DocumentSearchFilters,
  DocumentSearchPage,
  NewAssignment,
  NewDocument,
  NewWorkflowEvent,
  PlacementResult,
  ReferenceDocumentSummary,
  SignatureEventRow,
  WorkflowEventRow,
} from '../src/modules/documents/documents.repository.js';
import type { ReleaseMethod } from '../src/modules/workflow/workflow.service.js';

const now = () => new Date();

/**
 * Stand-in for {@link DocumentsRepository} in the full-app REST suites, which run without a
 * database. It keeps the aggregate in Maps and — crucially — reuses the very same pure
 * {@link AuthorizationPolicy} and {@link DocumentSearchService} the SQL repository is proven
 * to agree with (`query-scope.int.test.ts`), so scope, filtering, sort and pagination behave
 * identically here and against Postgres.
 *
 * Placement validation is intentionally permissive: FK integrity is a database concern the
 * integration suite covers. Everything the HTTP layer, authorization and workflow exercise is
 * faithful.
 */
export class InMemoryDocumentsRepository {
  private readonly authorization = new AuthorizationPolicy();
  private readonly search_ = new DocumentSearchService(this.authorization);
  private readonly documents = new Map<string, DocumentRow>();
  private readonly timeline = new Map<string, WorkflowEventRow[]>();
  private readonly assignments = new Map<string, Set<string>>();
  private readonly shares = new Map<string, Set<string>>();
  private readonly revisions = new Map<
    string,
    {
      id: string;
      documentId: string;
      actorId: string;
      before: unknown;
      after: unknown;
      occurredAt: Date;
    }[]
  >();
  private readonly releaseMethods = new Map<string, ReleaseMethod>();
  private readonly routes = new Map<string, DocumentRouteRow[]>();
  /*
   * Division ids that stand in for the Office of the Regional Director.
   *
   * `division-records` is seeded because that is already what it models: the revision makes the
   * Records Unit a *Section within the ORD* (decision 152), so the fixtures' `division-records` /
   * `section-intake` pair is the ORD and its Records Unit under the older names. Renaming the
   * fixture ids belongs with the organization restructure, not with the workflow engine.
   */
  private readonly ordDivisionIds = new Set<string>(['division-records']);
  private readonly signatures = new Map<string, SignatureEventRow[]>();
  /*
   * The Reference Document join, in insertion order. A list rather than a Map keyed by the pair
   * because the reads are ordered by when the link was made, and because the row id is what the
   * outbox key is built from — see `insertReference`.
   */
  private readonly references: {
    id: string;
    outgoingDocumentId: string;
    incomingDocumentId: string;
    createdById: string;
    createdAt: Date;
  }[] = [];
  private trackingCounter = 0;
  private readonly referenceCounters = new Map<string, number>();

  resolvePlacement(divisionId: string): Promise<PlacementResult> {
    // Derive a stable, human-ish code from the id so outgoing references are still distinct.
    const code =
      divisionId
        .replace(/[^A-Za-z0-9]/g, '')
        .slice(-8)
        .toUpperCase() || 'DIV';
    return Promise.resolve({ ok: true, divisionCode: code });
  }

  allocateTracking(): Promise<number> {
    this.trackingCounter += 1;
    return Promise.resolve(this.trackingCounter);
  }

  allocateReference(divisionId: string, year: number): Promise<number> {
    const key = `${divisionId}:${year}`;
    const next = (this.referenceCounters.get(key) ?? 0) + 1;
    this.referenceCounters.set(key, next);
    return Promise.resolve(next);
  }

  insert(values: NewDocument): Promise<DocumentRow> {
    const timestamp = now();
    const row: DocumentRow = {
      id: values.id ?? randomUUID(),
      trackingNumber: values.trackingNumber,
      referenceNumber: values.referenceNumber ?? null,
      email: values.email ?? null,
      title: values.title,
      type: values.type,
      description: values.description ?? null,
      priority: values.priority,
      direction: values.direction,
      status: values.status ?? 'IN_PROCESS',
      sender: values.sender ?? null,
      company: values.company ?? null,
      divisionId: values.divisionId,
      sectionId: values.sectionId ?? null,
      createdById: values.createdById,
      confidential: values.confidential ?? false,
      dueAt: values.dueAt ?? null,
      version: values.version ?? 1,
      currentFileVersionId: values.currentFileVersionId ?? null,
      signedFileVersionId: values.signedFileVersionId ?? null,
      deletedAt: values.deletedAt ?? null,
      deletionReason: values.deletionReason ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.documents.set(row.id, row);
    return Promise.resolve(row);
  }

  findById(id: string): Promise<DocumentRow | null> {
    const row = this.documents.get(id);
    return Promise.resolve(row && row.deletedAt === null ? row : null);
  }

  findReadableById(actor: AuthorizationActor, id: string): Promise<DocumentRow | null> {
    const row = this.documents.get(id);
    if (row === undefined || row.deletedAt !== null) return Promise.resolve(null);
    return Promise.resolve(this.authorization.canRead(actor, this.resource(row)) ? row : null);
  }

  search(actor: AuthorizationActor, filters: DocumentSearchFilters): Promise<DocumentSearchPage> {
    /*
     * `PENDING` is derived from unaccepted route rows, so it is resolved here rather than handed to
     * the search service — which sees no routes and types its filter as the stored vocabulary for
     * exactly that reason. Applying it as a pre-filter mirrors what `documentIsPending` does in SQL,
     * so an HTTP test against this repository agrees with the real one.
     */
    const pendingOnly = filters.status === 'PENDING';
    const searchable: (SearchableDocument & { row: DocumentRow })[] = [...this.documents.values()]
      .filter((row) => row.deletedAt === null)
      .filter((row) => !pendingOnly || this.hasUnacceptedRoute(row.id))
      .map((row) => ({ ...this.searchable(row), row }));
    // Drop `undefined` keys so the query matches the search service's optional-property shape
    // under exactOptionalPropertyTypes; the values themselves are passed through unchanged.
    const query: DocumentSearchQuery = {
      ...(filters.search !== undefined ? { search: filters.search } : {}),
      ...(filters.status !== undefined && !pendingOnly
        ? { status: filters.status as SearchableDocument['status'] }
        : {}),
      ...(filters.priority !== undefined ? { priority: filters.priority } : {}),
      ...(filters.type !== undefined ? { type: filters.type } : {}),
      ...(filters.direction !== undefined ? { direction: filters.direction } : {}),
      ...(filters.divisionId !== undefined ? { divisionId: filters.divisionId } : {}),
      ...(filters.sectionId !== undefined ? { sectionId: filters.sectionId } : {}),
      ...(filters.sort !== undefined ? { sort: filters.sort } : {}),
      ...(filters.order !== undefined ? { order: filters.order } : {}),
      ...(filters.page !== undefined ? { page: filters.page } : {}),
      ...(filters.pageSize !== undefined ? { pageSize: filters.pageSize } : {}),
    };
    const result = this.search_.execute(actor, searchable, query);
    const byId = new Map(searchable.map((entry) => [entry.id, entry.row]));
    return Promise.resolve({
      items: result.items.map((item) => byId.get(item.id)!),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    });
  }

  updateMetadata(
    id: string,
    expectedVersion: number,
    patch: DocumentMetadataPatch,
  ): Promise<DocumentRow | null> {
    return Promise.resolve(this.applyVersioned(id, expectedVersion, patch));
  }

  updateForAction(
    id: string,
    expectedVersion: number,
    patch: DocumentActionPatch,
  ): Promise<DocumentRow | null> {
    return Promise.resolve(this.applyVersioned(id, expectedVersion, patch));
  }

  setCurrentFileVersion(documentId: string, versionId: string): Promise<DocumentRow | null> {
    const row = this.documents.get(documentId);
    if (row === undefined || row.deletedAt !== null) return Promise.resolve(null);
    const next = {
      ...row,
      currentFileVersionId: versionId,
      version: row.version + 1,
      updatedAt: now(),
    };
    this.documents.set(documentId, next);
    return Promise.resolve(next);
  }

  insertMetadataRevision(revision: {
    documentId: string;
    actorId: string;
    before: Record<string, unknown>;
    after: Record<string, unknown>;
  }): Promise<void> {
    const list = this.revisions.get(revision.documentId) ?? [];
    list.push({ id: randomUUID(), occurredAt: now(), ...revision });
    this.revisions.set(revision.documentId, list);
    return Promise.resolve();
  }

  listMetadataRevisions(
    documentId: string,
  ): Promise<{ id: string; actorId: string; before: unknown; after: unknown; occurredAt: Date }[]> {
    return Promise.resolve([...(this.revisions.get(documentId) ?? [])]);
  }

  nextWorkflowSequence(documentId: string): Promise<number> {
    return Promise.resolve((this.timeline.get(documentId)?.length ?? 0) + 1);
  }

  insertWorkflowEvent(event: NewWorkflowEvent): Promise<WorkflowEventRow> {
    const row: WorkflowEventRow = { id: randomUUID(), occurredAt: now(), ...event };
    const list = this.timeline.get(event.documentId) ?? [];
    list.push(row);
    this.timeline.set(event.documentId, list);
    return Promise.resolve(row);
  }

  listTimeline(documentId: string): Promise<WorkflowEventRow[]> {
    return Promise.resolve(
      [...(this.timeline.get(documentId) ?? [])].sort((a, b) => a.sequence - b.sequence),
    );
  }

  insertReleaseEvent(event: {
    documentId: string;
    releasedById: string;
    method: ReleaseMethod;
  }): Promise<void> {
    this.releaseMethods.set(event.documentId, event.method);
    return Promise.resolve();
  }

  findReleaseMethod(documentId: string): Promise<ReleaseMethod | null> {
    return Promise.resolve(this.releaseMethods.get(documentId) ?? null);
  }

  hasActiveAssignment(documentId: string, userId: string): Promise<boolean> {
    return Promise.resolve(this.assignments.get(documentId)?.has(userId) ?? false);
  }

  insertAssignment(assignment: NewAssignment): Promise<void> {
    const set = this.assignments.get(assignment.documentId) ?? new Set<string>();
    set.add(assignment.userId);
    this.assignments.set(assignment.documentId, set);
    return Promise.resolve();
  }

  listActiveAssigneeIds(documentId: string): Promise<string[]> {
    return Promise.resolve([...(this.assignments.get(documentId) ?? [])]);
  }

  listSharedUserIds(documentId: string): Promise<string[]> {
    return Promise.resolve([...(this.shares.get(documentId) ?? [])]);
  }

  listAssignedTo(userId: string): Promise<DocumentRow[]> {
    return Promise.resolve(
      [...this.documents.values()].filter(
        (row) => row.deletedAt === null && (this.assignments.get(row.id)?.has(userId) ?? false),
      ),
    );
  }

  findByIdIncludingDeleted(id: string): Promise<DocumentRow | null> {
    return Promise.resolve(this.documents.get(id) ?? null);
  }

  softDelete(id: string, expectedVersion: number): Promise<DocumentRow | null> {
    return Promise.resolve(this.applyVersioned(id, expectedVersion, { deletedAt: now() }));
  }

  /**
   * Mirrors the SQL guard rather than reusing {@link applyVersioned}, which refuses a deleted row:
   * restore is the one mutation that requires the row to *be* deleted.
   */
  restore(id: string, expectedVersion: number): Promise<DocumentRow | null> {
    const row = this.documents.get(id);
    if (row === undefined || row.deletedAt === null || row.version !== expectedVersion)
      return Promise.resolve(null);
    const next = { ...row, deletedAt: null, version: row.version + 1, updatedAt: now() };
    this.documents.set(id, next);
    return Promise.resolve(next);
  }

  listDeleted(actor: AuthorizationActor): Promise<DocumentRow[]> {
    return Promise.resolve(
      [...this.documents.values()].filter(
        (row) => row.deletedAt !== null && this.authorization.canRead(actor, this.resource(row)),
      ),
    );
  }

  bumpVersion(id: string, expectedVersion: number): Promise<DocumentRow | null> {
    return Promise.resolve(this.applyVersioned(id, expectedVersion, {}));
  }

  insertRoute(route: {
    documentId: string;
    fromDivisionId: string | null;
    toDivisionId: string;
    toSectionId: string | null;
    routedById: string;
    remarks: string | null;
    forInformation?: boolean;
  }): Promise<void> {
    const list = this.routes.get(route.documentId) ?? [];
    list.push({
      id: randomUUID(),
      completedAt: null,
      createdAt: now(),
      forInformation: false,
      acceptedAt: null,
      acceptedById: null,
      ...route,
    });
    this.routes.set(route.documentId, list);
    return Promise.resolve();
  }

  /** Mirrors the SQL predicate: an already-accepted route matches no row and yields null. */
  acceptRoute(routeId: string, acceptedById: string): Promise<DocumentRouteRow | null> {
    for (const list of this.routes.values()) {
      const route = list.find((candidate) => candidate.id === routeId);
      if (route === undefined) continue;
      if (route.acceptedAt !== null) return Promise.resolve(null);
      route.acceptedAt = now();
      route.acceptedById = acceptedById;
      return Promise.resolve(route);
    }
    return Promise.resolve(null);
  }

  /**
   * The in-memory twin of `custodyDivisionId` / `custodySectionId`: the most recent hop that took
   * custody, falling back to the registering placement when there are no hops at all.
   */
  private custodyOf(row: DocumentRow): { divisionId: string; sectionId: string | null } {
    const hops = (this.routes.get(row.id) ?? []).filter((route) => !route.forInformation);
    const lead = hops[hops.length - 1];
    if (lead === undefined) return { divisionId: row.divisionId, sectionId: row.sectionId };
    return { divisionId: lead.toDivisionId, sectionId: lead.toSectionId };
  }

  /** The in-memory twin of the `documentIsPending` SQL predicate. */
  private hasUnacceptedRoute(documentId: string): boolean {
    return (this.routes.get(documentId) ?? []).some((route) => route.acceptedAt === null);
  }

  isOrdDivision(divisionId: string): Promise<boolean> {
    return Promise.resolve(this.ordDivisionIds.has(divisionId));
  }

  /** Test seam: marks a division as the ORD so the `FOR_INITIAL` exemption can be exercised. */
  markAsOrd(divisionId: string): void {
    this.ordDivisionIds.add(divisionId);
  }

  listRoutes(documentId: string): Promise<DocumentRouteRow[]> {
    return Promise.resolve([...(this.routes.get(documentId) ?? [])]);
  }

  insertSignatureEvent(signature: {
    documentId: string;
    fileVersionId: string;
    signerId: string;
  }): Promise<void> {
    const list = this.signatures.get(signature.documentId) ?? [];
    list.push({ id: randomUUID(), signedAt: now(), ...signature });
    this.signatures.set(signature.documentId, list);
    return Promise.resolve();
  }

  listSignatures(documentId: string): Promise<SignatureEventRow[]> {
    return Promise.resolve([...(this.signatures.get(documentId) ?? [])]);
  }

  /** Mirrors `ON CONFLICT DO NOTHING` on the unique pair: a repeat link makes no row and returns null. */
  insertReference(reference: {
    outgoingDocumentId: string;
    incomingDocumentId: string;
    createdById: string;
  }): Promise<string | null> {
    const existing = this.references.some(
      (row) =>
        row.outgoingDocumentId === reference.outgoingDocumentId &&
        row.incomingDocumentId === reference.incomingDocumentId,
    );
    if (existing) return Promise.resolve(null);
    const id = randomUUID();
    this.references.push({ id, createdAt: now(), ...reference });
    return Promise.resolve(id);
  }

  /**
   * Mirrors the scoped `DELETE`: the readability of the target is part of the match, so a link
   * whose target this actor cannot read yields null — the same answer as no link at all, which is
   * what makes the two indistinguishable at the HTTP boundary (decision 166).
   */
  deleteReference(
    actor: AuthorizationActor,
    outgoingDocumentId: string,
    incomingDocumentId: string,
  ): Promise<string | null> {
    const index = this.references.findIndex(
      (row) =>
        row.outgoingDocumentId === outgoingDocumentId &&
        row.incomingDocumentId === incomingDocumentId &&
        this.isReadable(actor, row.incomingDocumentId),
    );
    if (index === -1) return Promise.resolve(null);
    const [removed] = this.references.splice(index, 1);
    return Promise.resolve(removed!.id);
  }

  listReferencedDocuments(
    actor: AuthorizationActor,
    outgoingDocumentId: string,
  ): Promise<ReferenceDocumentSummary[]> {
    return Promise.resolve(
      this.references
        .filter((row) => row.outgoingDocumentId === outgoingDocumentId)
        .map((row) => this.referenceSummary(actor, row.incomingDocumentId))
        // Absent, not nulled: the entries this actor cannot read leave no placeholder behind, so
        // two readers see different lengths for the same document (decision 166).
        .filter((summary): summary is ReferenceDocumentSummary => summary !== null),
    );
  }

  listReplyDocuments(
    actor: AuthorizationActor,
    incomingDocumentId: string,
  ): Promise<ReferenceDocumentSummary[]> {
    return Promise.resolve(
      this.references
        .filter((row) => row.incomingDocumentId === incomingDocumentId)
        .map((row) => this.referenceSummary(actor, row.outgoingDocumentId))
        .filter((summary): summary is ReferenceDocumentSummary => summary !== null),
    );
  }

  private isReadable(actor: AuthorizationActor, documentId: string): boolean {
    const row = this.documents.get(documentId);
    if (row === undefined || row.deletedAt !== null) return false;
    return this.authorization.canRead(actor, this.resource(row));
  }

  private referenceSummary(
    actor: AuthorizationActor,
    documentId: string,
  ): ReferenceDocumentSummary | null {
    const row = this.documents.get(documentId);
    if (row === undefined || !this.isReadable(actor, documentId)) return null;
    return {
      id: row.id,
      trackingNumber: row.trackingNumber,
      title: row.title,
      direction: row.direction,
      status: row.status,
      createdAt: row.createdAt,
    };
  }

  insertShare(share: { documentId: string; userId: string; sharedById: string }): Promise<void> {
    const set = this.shares.get(share.documentId) ?? new Set<string>();
    set.add(share.userId);
    this.shares.set(share.documentId, set);
    return Promise.resolve();
  }

  listForReport(actor: AuthorizationActor, year: number, month: number): Promise<DocumentRow[]> {
    const start = Date.UTC(year, month - 1, 1);
    const end = Date.UTC(year, month, 1);
    return Promise.resolve(
      [...this.documents.values()].filter(
        (row) =>
          row.deletedAt === null &&
          this.authorization.canRead(actor, this.resource(row)) &&
          row.createdAt.getTime() >= start &&
          row.createdAt.getTime() < end,
      ),
    );
  }

  private applyVersioned(
    id: string,
    expectedVersion: number,
    patch: Partial<DocumentRow>,
  ): DocumentRow | null {
    const row = this.documents.get(id);
    if (row === undefined || row.deletedAt !== null || row.version !== expectedVersion) return null;
    const next = { ...row, ...patch, version: row.version + 1, updatedAt: now() };
    this.documents.set(id, next);
    return next;
  }

  private resource(row: DocumentRow) {
    return {
      id: row.id,
      divisionId: row.divisionId,
      sectionId: row.sectionId,
      ...this.facts(row.id),
      confidential: row.confidential,
    };
  }

  /** The in-memory twin of `DocumentsRepository.authorizationFacts`, for one document. */
  private facts(documentId: string): DocumentAuthorizationFacts {
    return {
      routes: (this.routes.get(documentId) ?? []).map((route) => ({
        toDivisionId: route.toDivisionId,
        toSectionId: route.toSectionId,
        forInformation: route.forInformation,
      })),
      assigneeUserIds: [...(this.assignments.get(documentId) ?? [])],
      sharedUserIds: [...(this.shares.get(documentId) ?? [])],
    };
  }

  authorizationFacts(
    documentIds: readonly string[],
  ): Promise<Map<string, DocumentAuthorizationFacts>> {
    return Promise.resolve(new Map(documentIds.map((id) => [id, this.facts(id)])));
  }

  private searchable(row: DocumentRow): SearchableDocument {
    const custody = this.custodyOf(row);
    return {
      custodyDivisionId: custody.divisionId,
      custodySectionId: custody.sectionId,
      title: row.title,
      trackingNumber: row.trackingNumber,
      referenceNumber: row.referenceNumber,
      sender: row.sender,
      company: row.company,
      description: row.description,
      status: row.status,
      priority: row.priority,
      type: row.type,
      direction: row.direction,
      createdAt: row.createdAt,
      ...this.resource(row),
    };
  }
}
