import { relations, sql } from 'drizzle-orm';
import {
  boolean,
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

export const roleEnum = pgEnum('role', [
  'ADMINISTRATOR',
  'RECORDS_STAFF',
  'DIVISION_HEAD',
  'STAFF_MEMBER',
  'VIEWER',
]);
export const directionEnum = pgEnum('document_direction', ['INCOMING', 'OUTGOING']);
export const priorityEnum = pgEnum('document_priority', ['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const statusEnum = pgEnum('workflow_status', [
  'PENDING',
  'IN_PROCESS',
  'FOR_REVISION',
  'FOR_SIGNATURE',
  'SIGNED',
  'FOR_RELEASE',
  'RELEASED',
  'ARCHIVED',
]);
export const scanStatusEnum = pgEnum('scan_status', [
  'PENDING',
  'PENDING_RETRY',
  'CLEAN',
  'INFECTED',
  'SCAN_FAILED',
]);
export const releaseMethodEnum = pgEnum('release_method', [
  'MAILED',
  'EMAILED',
  'PICKED_UP',
  'DELIVERED',
]);
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
    status: statusEnum('status').notNull().default('PENDING'),
    sender: varchar('sender', { length: 240 }),
    company: varchar('company', { length: 240 }),
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

export const documentRoutes = pgTable('document_routes', {
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
  remarks: text('remarks'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

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
    fromStatus: statusEnum('from_status'),
    toStatus: statusEnum('to_status').notNull(),
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
  method: releaseMethodEnum('method').notNull(),
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
