import { relations, sql } from 'drizzle-orm';
import {
  storedWorkflowStatusSchema,
  type DocumentRecipient,
  type StoredWorkflowStatus,
} from '@dts/contracts';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { customBytea, identityColumns, timestampColumns, versionColumn } from './schema-helpers.js';

// Written out by hand rather than derived from `roleSchema`, unlike the status enum below: the
// order here is the order values were added to the Postgres type, and `ALTER TYPE ... ADD VALUE`
// appends. Keep the list in step with `roleSchema` in `@dts/contracts`.
export const roleEnum = pgEnum('role', [
  'ADMINISTRATOR',
  'RECORDS_STAFF',
  'DIVISION_HEAD',
  'STAFF_MEMBER',
  'VIEWER',
  'DIRECTOR',
]);
export const directionEnum = pgEnum('document_direction', ['INCOMING', 'OUTGOING']);
export const priorityEnum = pgEnum('document_priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']);
/*
 * Derived from `@dts/contracts` rather than listed again: the status vocabulary used to be written
 * out here, in the contracts package and in `WorkflowService`, and keeping three copies aligned was
 * manual. `storedWorkflowStatusSchema` excludes `PENDING`, which ADR-0005 makes a derived condition
 * (an unaccepted route row) rather than a column value — so the database cannot hold it at all.
 *
 * The cast restores the non-empty-tuple shape `pgEnum` requires; zod widens `.exclude()` to a
 * plain array, and the values themselves are exactly `StoredWorkflowStatus`.
 */
const storedStatuses = storedWorkflowStatusSchema.options as unknown as readonly [
  StoredWorkflowStatus,
  ...StoredWorkflowStatus[],
];
export const statusEnum = pgEnum('workflow_status', storedStatuses);
export const scanStatusEnum = pgEnum('scan_status', [
  'PENDING',
  'PENDING_RETRY',
  'CLEAN',
  'INFECTED',
  'SCAN_FAILED',
]);
/*
 * Release methods are configurable **rows**, not a pgEnum. Decision 27 always said "or another
 * configured allowed method" and the schema never honoured it, so for a long while LBC and JRS —
 * two of the couriers the office actually uses — could not be recorded at all, and adding one
 * meant an `ALTER TYPE` and a deploy (policy register P-15).
 *
 * `code` is the stable identifier a command carries on the wire; `label` is what the picker and
 * the routing slip show, so renaming "Postal" costs an UPDATE and breaks no stored event. Rows are
 * deactivated rather than deleted, because `release_events` cites them as evidence of how a
 * document left the office.
 */
export const releaseMethods = pgTable('release_methods', {
  ...identityColumns(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  label: varchar('label', { length: 80 }).notNull().unique(),
  /*
   * P-15 as decided 2026-10-06: releasing asks how the document left and, only for Mailed, by
   * which carrier. The flag rather than a hard-coded `MAILED` check, so the rule reads off the row.
   */
  requiresCarrier: boolean('requires_carrier').notNull().default(false),
  active: boolean('active').notNull().default(true),
  // The order the office reads the list in, which is neither alphabetical nor insertion order.
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestampColumns(),
});

/*
 * The carriers a mailed document travels by: Postal, LBC, JRS (migration `0013`). Configurable
 * rows for the same reasons as the methods, and deactivated rather than deleted for the same
 * reason too — `release_events` cites them.
 */
export const releaseCarriers = pgTable('release_carriers', {
  ...identityColumns(),
  code: varchar('code', { length: 40 }).notNull().unique(),
  label: varchar('label', { length: 80 }).notNull().unique(),
  /*
   * Decision 27 as amended: a tracking reference may be required, and then it is mandatory at
   * release. Every carrier the office uses issues one, so all three are seeded `true`; the flag
   * stays per carrier so one that does not can be configured without a code change.
   */
  requiresTrackingReference: boolean('requires_tracking_reference').notNull().default(true),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestampColumns(),
});
export const auditOutcomeEnum = pgEnum('audit_outcome', ['SUCCESS', 'FAILURE']);
export const accountRequestStatusEnum = pgEnum('account_request_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
]);

export const divisions = pgTable('divisions', {
  ...identityColumns(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 160 }).notNull().unique(),
  active: boolean('active').notNull().default(true),
  ...timestampColumns(),
});

export const sections = pgTable(
  'sections',
  {
    ...identityColumns(),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id),
    code: varchar('code', { length: 20 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    active: boolean('active').notNull().default(true),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex('sections_division_name_uq').on(table.divisionId, table.name),
    uniqueIndex('sections_division_code_uq').on(table.divisionId, table.code),
  ],
);

export const users = pgTable('users', {
  ...identityColumns(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  displayName: varchar('display_name', { length: 200 }).notNull(),
  passwordHash: varchar('password_hash', { length: 100 }).notNull(),
  role: roleEnum('role').notNull(),
  divisionId: uuid('division_id').references(() => divisions.id),
  sectionId: uuid('section_id').references(() => sections.id),
  canAccessConfidential: boolean('can_access_confidential').notNull().default(false),
  active: boolean('active').notNull().default(true),
  // Lockout state lives on the user row rather than in a cache so a restart cannot wipe it.
  // Both columns are cleared on a successful login; `lockedUntil` in the future is the lock.
  failedLoginAttempts: integer('failed_login_attempts').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  // Sessions carry the value they were issued under; bumping it ends them all (risk R-22).
  sessionVersion: integer('session_version').notNull().default(0),
  passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  ...timestampColumns(),
});

// Profile photos are small, non-evidentiary and never versioned, so they live in Postgres
// instead of the object store that Phase 4 introduces for document attachments. One row per
// user; replacing a photo overwrites the row.
export const profilePhotos = pgTable('profile_photos', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaType: varchar('media_type', { length: 80 }).notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
  content: customBytea('content').notNull(),
  ...timestampColumns(),
});

export const accountRequests = pgTable(
  'account_requests',
  {
    ...identityColumns(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 200 }).notNull(),
    passwordHash: varchar('password_hash', { length: 100 }).notNull(),
    status: accountRequestStatusEnum('status').notNull().default('PENDING'),
    requestedDivisionId: uuid('requested_division_id').references(() => divisions.id),
    requestedSectionId: uuid('requested_section_id').references(() => sections.id),
    justification: text('justification'),
    reviewedById: uuid('reviewed_by_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    createdUserId: uuid('created_user_id').references(() => users.id),
    ...timestampColumns(),
  },
  (table) => [
    // One open request per address at a time. Rejected requests stay for the audit trail and
    // do not block the applicant from trying again, so the constraint is partial.
    uniqueIndex('account_requests_pending_email_uq')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.status} = 'PENDING'`),
    index('account_requests_status_idx').on(table.status, table.createdAt),
  ],
);

export const referenceCounters = pgTable(
  'reference_counters',
  {
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id),
    year: integer('year').notNull(),
    value: integer('value').notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.divisionId, table.year] })],
);

// Office-wide allocator for the human-facing tracking number stamped on every document at
// registration. A tracking number only has to be unique, not gap-free, so a single counter
// row per scope (incremented with `... ON CONFLICT DO UPDATE ... RETURNING`) is enough; the
// year lives in the formatted string, not the key, mirroring the prototype's monotonic
// sequence. Outgoing *reference* numbers are formal correspondence numbers and are allocated
// separately, per division and year, from `reference_counters`.
export const documentSequences = pgTable('document_sequences', {
  scope: varchar('scope', { length: 60 }).primaryKey(),
  value: integer('value').notNull().default(0),
});

/*
 * Office-wide settings, one row (`id` is pinned to 1). Holds who the Head of the Bureau is, because
 * every outgoing document is sent in that name and it must be changeable without a deploy.
 */
export const officeSettings = pgTable(
  'office_settings',
  {
    id: integer('id').primaryKey().default(1),
    headOfBureauName: varchar('head_of_bureau_name', { length: 160 }).notNull().default(''),
    headOfBureauTitle: varchar('head_of_bureau_title', { length: 160 })
      .notNull()
      .default('Regional Director'),
    updatedById: uuid('updated_by_id').references(() => users.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('office_settings_single_row', sql`${table.id} = 1`)],
);

export const documents = pgTable(
  'documents',
  {
    ...identityColumns(),
    trackingNumber: varchar('tracking_number', { length: 40 }).notNull().unique(),
    referenceNumber: varchar('reference_number', { length: 120 }),
    title: varchar('title', { length: 240 }).notNull(),
    type: varchar('type', { length: 80 }).notNull(),
    description: text('description'),
    priority: priorityEnum('priority').notNull(),
    direction: directionEnum('direction').notNull(),
    /*
     * The business lifecycle only. Custody — who holds the document and whether they have taken
     * it on — lives on `document_routes` (ADR-0005), which is why there is no `PENDING` here:
     * registration confers no custody (decision 154), so a new document enters the trunk at
     * IN_PROCESS and is *presented* as pending until its route is accepted.
     */
    status: statusEnum('status').notNull().default('IN_PROCESS'),
    sender: varchar('sender', { length: 240 }),
    company: varchar('company', { length: 240 }),
    /*
     * Contact address for the correspondent. Deliberately NOT folded into `reference_number`:
     * that column is uniquely indexed where not null, and two documents from the same
     * correspondent share an email address as a matter of course.
     */
    email: varchar('email', { length: 240 }),
    /*
     * The addressees of an outgoing document, in the order they were entered: a name and any number
     * of optional email addresses each. Free text because most recipients are outside the system.
     * Empty for an incoming document, whose correspondent is `sender`.
     */
    recipients: jsonb('recipients')
      .$type<DocumentRecipient[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => divisions.id),
    sectionId: uuid('section_id').references(() => sections.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    confidential: boolean('confidential').notNull().default(false),
    dueAt: timestamp('due_at', { withTimezone: true }),
    version: versionColumn(),
    currentFileVersionId: uuid('current_file_version_id'),
    signedFileVersionId: uuid('signed_file_version_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletionReason: text('deletion_reason'),
    ...timestampColumns(),
  },
  (table) => [
    uniqueIndex('documents_reference_number_uq')
      .on(table.referenceNumber)
      .where(sql`${table.referenceNumber} is not null`),
    index('documents_scope_status_idx').on(table.divisionId, table.sectionId, table.status),
    index('documents_created_at_idx').on(table.createdAt),
  ],
);

export const documentMetadataRevisions = pgTable('document_metadata_revisions', {
  ...identityColumns(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  before: jsonb('before').notNull(),
  after: jsonb('after').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
});

export const documentAssignments = pgTable(
  'document_assignments',
  {
    ...identityColumns(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    userId: uuid('user_id').references(() => users.id),
    divisionId: uuid('division_id').references(() => divisions.id),
    sectionId: uuid('section_id').references(() => sections.id),
    active: boolean('active').notNull().default(true),
    assignedById: uuid('assigned_by_id')
      .notNull()
      .references(() => users.id),
    ...timestampColumns(),
  },
  (table) => [index('assignments_user_active_idx').on(table.userId, table.active)],
);

export const documentShares = pgTable(
  'document_shares',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sharedById: uuid('shared_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.userId] })],
);

/*
 * The Reference Document relation: an outgoing document names the incoming documents it answers,
 * and each of those reads the inverse as its replies (decision 165).
 *
 * A *relationship*, not a string. `documents.reference_number` is already two different things —
 * the office's identifier for an outgoing document, the sender's free text on an incoming one — so
 * nothing in this table is called `reference` unqualified; `REFERENCES` is a SQL reserved word
 * besides, which settles it.
 *
 * **Direction is a service-level rule, not a column constraint.** `outgoing_document_id` must name
 * an `OUTGOING` document and `incoming_document_id` an `INCOMING` one, which SQL cannot express
 * across tables without a trigger, so the check lives in `DocumentsService.linkReferenceDocument`.
 * Enforcing it buys a guarantee worth writing down: an incoming document can never be the naming
 * side, so the relation cannot contain a cycle. No cycle check, depth limit or recursive guard is
 * needed anywhere here — and none should be added later "for safety".
 *
 * The `CHECK` below is the one malformed row direction would not catch if the service check were
 * ever bypassed, and it costs nothing.
 */
export const documentReferences = pgTable(
  'document_references',
  {
    ...identityColumns(),
    outgoingDocumentId: uuid('outgoing_document_id')
      .notNull()
      .references(() => documents.id),
    incomingDocumentId: uuid('incoming_document_id')
      .notNull()
      .references(() => documents.id),
    createdById: uuid('created_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * What makes linking idempotent without a read-before-write: the insert is
     * `ON CONFLICT DO NOTHING`, so a double submit is a quiet success rather than a 409 and the
     * audit trail does not grow a second identical event (decision 179).
     */
    uniqueIndex('document_references_pair_uq').on(
      table.outgoingDocumentId,
      table.incomingDocumentId,
    ),
    /*
     * The reverse read — an incoming document's replies — which is the half the composite unique
     * index above cannot serve, since it leads with the outgoing id.
     */
    index('document_references_incoming_idx').on(table.incomingDocumentId),
    check(
      'document_references_not_self',
      sql`${table.outgoingDocumentId} <> ${table.incomingDocumentId}`,
    ),
  ],
);

/*
 * One row per custody hop. This table — not `documents.status` — answers "who is sitting on this,
 * and since when" (ADR-0005), which is the operational question the system exists to answer and the
 * layout the bureau's routing slip is printed in.
 *
 * `acceptedAt` / `acceptedById` are the recipient's recorded acknowledgement that it has taken the
 * document on. A row with a null `acceptedAt` is what makes a document *pending*: the condition is
 * derived from these rows, so a document routed to three divisions can be accepted by two of them,
 * which one status column could never express.
 */
export const documentRoutes = pgTable(
  'document_routes',
  {
    ...identityColumns(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    fromDivisionId: uuid('from_division_id').references(() => divisions.id),
    toDivisionId: uuid('to_division_id')
      .notNull()
      .references(() => divisions.id),
    toSectionId: uuid('to_section_id').references(() => sections.id),
    routedById: uuid('routed_by_id')
      .notNull()
      .references(() => users.id),
    /*
     * A forward names exactly one lead recipient, which takes custody and on whose action the
     * workflow progresses; the rest are consulted for information only — read and remark, no
     * workflow action, and never a block on progress (decisions 159–160). The default is false
     * because a plain route of one is a lead route.
     */
    forInformation: boolean('for_information').notNull().default(false),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedById: uuid('accepted_by_id').references(() => users.id),
    remarks: text('remarks'),
    /*
     * Deliberately unused, not an unfinished column. ADR-0005 weighed a separate completion table
     * and kept this one instead, because custody and completion are facts about the same hop. The
     * gate that matters is `accepted_at` — `leadRouteOutstanding` in `workflow.service.ts` asks
     * whether the lead hop is unaccepted, and nothing yet needs to record that a hop is finished as
     * distinct from superseded by the next one. Leave it until a requirement asks for it.
     */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /*
     * Backs the derived-pending `EXISTS` probe. ADR-0005 notes that a derived condition cannot be
     * indexed as a column; a partial index on the unaccepted rows is the equivalent, and it stays
     * small because rows leave it as soon as they are accepted.
     */
    index('document_routes_unaccepted_idx')
      .on(table.documentId)
      .where(sql`${table.acceptedAt} is null`),
    /*
     * Backs the route half of placement scope — `routedToUnit` in `query-scope.ts`, which asks
     * "has any hop been addressed to this unit" for every list, count and export. The index above
     * cannot serve it: that one is partial on the unaccepted rows, and this predicate deliberately
     * ignores `accepted_at` (a recipient must be able to read a document in order to accept it).
     */
    index('document_routes_recipient_idx').on(
      table.toDivisionId,
      table.toSectionId,
      table.documentId,
    ),
    /*
     * Backs every per-document read of the hops: the current-lead-hop subquery behind
     * `custodyDivisionId` / `custodySectionId` (a backward scan that stops at the first lead hop)
     * and the routing slip's ascending list. Neither index above leads with the document, so before
     * migration 0011 each of those subqueries scanned the whole table once per document — D1's
     * EXPLAIN pass measured the registry's division filter at about ninety seconds on pilot-sized
     * data (`docs/evidence/d1-query-plans.md`).
     */
    index('document_routes_document_idx').on(table.documentId, table.createdAt, table.id),
  ],
);

export const workflowEvents = pgTable(
  'workflow_events',
  {
    ...identityColumns(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id),
    sequence: integer('sequence').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    action: varchar('action', { length: 60 }).notNull(),
    /*
     * Free text, not the live `workflow_status` enum. These columns record what the vocabulary was
     * when the event happened, so a row written before the 2026-10-02 revision still reads
     * 'PENDING' — which is the truth about that hop. Binding history to a type that each
     * vocabulary change rewrites would make the timeline something a migration edits, and the
     * timeline is evidence. `action` has always been varchar for the same reason.
     */
    fromStatus: varchar('from_status', { length: 40 }),
    toStatus: varchar('to_status', { length: 40 }).notNull(),
    remarks: text('remarks'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('workflow_events_document_sequence_uq').on(table.documentId, table.sequence),
  ],
);

export const fileRecords = pgTable('file_records', {
  ...identityColumns(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  createdById: uuid('created_by_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const fileVersions = pgTable(
  'file_versions',
  {
    ...identityColumns(),
    fileRecordId: uuid('file_record_id')
      .notNull()
      .references(() => fileRecords.id),
    versionNumber: integer('version_number').notNull(),
    objectKey: text('object_key').notNull().unique(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mediaType: varchar('media_type', { length: 120 }).notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    checksumSha256: varchar('checksum_sha256', { length: 64 }).notNull(),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id),
    scanStatus: scanStatusEnum('scan_status').notNull().default('PENDING'),
    administrativelyRestricted: boolean('administratively_restricted').notNull().default(false),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('file_versions_record_number_uq').on(table.fileRecordId, table.versionNumber),
  ],
);

export const signatureEvents = pgTable('signature_events', {
  ...identityColumns(),
  documentId: uuid('document_id')
    .notNull()
    .references(() => documents.id),
  fileVersionId: uuid('file_version_id')
    .notNull()
    .references(() => fileVersions.id),
  signerId: uuid('signer_id')
    .notNull()
    .references(() => users.id),
  signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
});

export const releaseEvents = pgTable('release_events', {
  ...identityColumns(),
  documentId: uuid('document_id')
    .notNull()
    .unique()
    .references(() => documents.id),
  releasedById: uuid('released_by_id')
    .notNull()
    .references(() => users.id),
  methodId: uuid('method_id')
    .notNull()
    .references(() => releaseMethods.id),
  /*
   * Set when the method takes a carrier. Null on every other method, and also on a mailed release
   * recorded before carriers were asked for: migration `0013` will not invent the carrier such a
   * row never recorded, so it reads "carrier not recorded" until Records staff fill it in. That
   * fill-in is the one update this table takes, and it only ever replaces a null.
   */
  carrierId: uuid('carrier_id').references(() => releaseCarriers.id),
  /*
   * The carrier's consignment number, where the carrier requires one. Nullable because most
   * methods do not: a document picked up at the counter has nothing to track. The "required when
   * the method says so" rule is enforced in `WorkflowService`, which is where every other release
   * precondition lives.
   */
  trackingReference: varchar('tracking_reference', { length: 120 }),
  releasedAt: timestamp('released_at', { withTimezone: true }).notNull().defaultNow(),
});

export const notifications = pgTable(
  'notifications',
  {
    ...identityColumns(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id),
    type: varchar('type', { length: 60 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    body: text('body').notNull(),
    documentId: uuid('document_id').references(() => documents.id),
    idempotencyKey: varchar('idempotency_key', { length: 240 }).notNull().unique(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_recipient_unread_idx').on(
      table.recipientUserId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    ...identityColumns(),
    actorId: uuid('actor_id').references(() => users.id),
    action: varchar('action', { length: 100 }).notNull(),
    targetType: varchar('target_type', { length: 80 }).notNull(),
    targetId: varchar('target_id', { length: 160 }).notNull(),
    outcome: auditOutcomeEnum('outcome').notNull(),
    correlationId: uuid('correlation_id').notNull(),
    sourceIp: varchar('source_ip', { length: 64 }),
    summary: jsonb('summary').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_actor_action_date_idx').on(table.actorId, table.action, table.occurredAt),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    ...identityColumns(),
    aggregateType: varchar('aggregate_type', { length: 80 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    payload: jsonb('payload').notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 240 }).notNull().unique(),
    attempts: integer('attempts').notNull().default(0),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('outbox_unpublished_idx').on(table.publishedAt, table.createdAt)],
);

export const divisionRelations = relations(divisions, ({ many }) => ({
  sections: many(sections),
  users: many(users),
  documents: many(documents),
}));
export const documentRelations = relations(documents, ({ one, many }) => ({
  division: one(divisions, { fields: [documents.divisionId], references: [divisions.id] }),
  section: one(sections, { fields: [documents.sectionId], references: [sections.id] }),
  workflowEvents: many(workflowEvents),
  fileRecords: many(fileRecords),
  assignments: many(documentAssignments),
  shares: many(documentShares),
}));
