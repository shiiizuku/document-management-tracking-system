import type { AccountRequest, AdminUser } from '../src/features/admin/queries';
import type { AttachmentGroup, AttachmentVersion } from '../src/features/attachments/queries';
import type { AuditEvent, AuditPage } from '../src/features/audit/queries';
import type {
  DocumentDetail,
  DocumentListItem,
  ReferenceDocumentSummary,
} from '../src/features/documents/queries';
import type { Notification } from '../src/features/notifications/queries';
import type { Division, Section } from '../src/features/org/queries';
import type { MonthlyReport } from '../src/features/reports/queries';
import type { SessionUser } from '../src/features/session/queries';

/**
 * Wire-shaped fixtures, built with every field the API actually sends.
 *
 * Partial objects cast into place would let a screen read a field no fixture sets, so a missing
 * field would surface as `undefined` in a passing test rather than as a type error here.
 */

/**
 * Organization ids as the API really serves them: UUIDs.
 *
 * Spelled out rather than left as readable slugs because several contract schemas declare these
 * fields `z.uuid()` — an approval or a user edit built from `'division-1'` fails client-side
 * validation, which makes a fixture problem look like a form bug.
 */
export const DIVISION_ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const SECTION_ID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

export const sessionUser = (overrides: Partial<SessionUser> = {}): SessionUser => ({
  id: 'user-1',
  email: 'records@dts.local',
  displayName: 'Records Officer',
  role: 'RECORDS_STAFF',
  divisionId: 'division-1',
  sectionId: null,
  capabilities: ['DOCUMENT_CREATE', 'DOCUMENT_EDIT', 'DOCUMENT_ACCEPT', 'REPORT_VIEW'],
  canAccessConfidential: false,
  active: true,
  ...overrides,
});

export const documentItem = (overrides: Partial<DocumentListItem> = {}): DocumentListItem => ({
  id: 'doc-1',
  trackingNumber: 'DTS-2026-000001',
  referenceNumber: 'REF-9',
  email: null,
  recipients: [],
  title: 'Incoming budget letter',
  type: 'LETTER',
  description: 'Covering letter for the quarterly budget submission.',
  priority: 'NORMAL',
  direction: 'INCOMING',
  status: 'PENDING',
  presentedStatus: 'PENDING',
  sender: 'Regional Office',
  company: 'Department of Finance',
  divisionId: 'division-1',
  sectionId: null,
  createdById: 'user-1',
  confidential: false,
  dueAt: null,
  version: 3,
  currentAttachmentVersionId: null,
  signedAttachmentVersionId: null,
  hasCleanCurrentAttachment: false,
  releaseMethod: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  ...overrides,
});

/**
 * A reference as the detail payload summarises it. The lists it goes in are short by omission
 * (decision 166), so a fixture holding one reference is a reader who may read one — not a document
 * that has one.
 */
export const referenceSummary = (
  overrides: Partial<ReferenceDocumentSummary> = {},
): ReferenceDocumentSummary => ({
  id: 'doc-2',
  trackingNumber: 'DTS-2026-000002',
  title: 'Request for ore transport permits',
  direction: 'INCOMING',
  status: 'IN_PROCESS',
  createdAt: '2026-08-20T01:00:00.000Z',
  ...overrides,
});

export const documentDetail = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  ...documentItem(),
  assigneeUserIds: [],
  sharedUserIds: [],
  referencedDocuments: [],
  replyDocuments: [],
  routes: [],
  signatures: [],
  timeline: [
    {
      id: 'event-1',
      sequence: 1,
      actorId: 'user-1',
      action: 'ACCEPT',
      fromStatus: 'PENDING',
      toStatus: 'IN_PROCESS',
      remarks: 'Logged at the front desk.',
      occurredAt: '2026-09-01T09:00:00.000Z',
    },
  ],
  allowedActions: ['ACCEPT'],
  ...overrides,
});

export const attachmentVersion = (
  overrides: Partial<AttachmentVersion> = {},
): AttachmentVersion => ({
  id: 'version-1',
  attachmentId: 'attachment-1',
  versionNumber: 1,
  originalName: 'budget.pdf',
  mediaType: 'application/pdf',
  sizeBytes: 2048,
  checksumSha256: 'a'.repeat(64),
  uploaderId: 'user-1',
  uploadedAt: '2026-09-01T09:30:00.000Z',
  scanStatus: 'CLEAN',
  isCurrent: true,
  isSigned: false,
  ...overrides,
});

export const attachmentGroup = (versions: AttachmentVersion[]): AttachmentGroup => ({
  attachmentId: versions[0]?.attachmentId ?? 'attachment-1',
  versions,
});

export const notification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'notification-1',
  type: 'DOCUMENT_ASSIGNED',
  title: 'Document assigned',
  body: 'DTS-2026-000001: Incoming budget letter',
  documentId: 'doc-1',
  readAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  ...overrides,
});

export const monthlyReport = (overrides: Partial<MonthlyReport> = {}): MonthlyReport => ({
  year: 2026,
  month: 9,
  totals: { incoming: 12, outgoing: 4, foiRequests: 2, specialOrders: 1, total: 16 },
  documents: [
    {
      id: 'doc-1',
      title: 'Incoming budget letter',
      referenceNumber: 'REF-9',
      sender: 'Regional Office',
      company: 'Department of Finance',
      type: 'LETTER',
      direction: 'INCOMING',
      createdAt: '2026-09-01T08:00:00.000Z',
      divisionId: 'division-1',
      sectionId: null,
      confidential: false,
    },
  ],
  ...overrides,
});

export const adminUser = (overrides: Partial<AdminUser> = {}): AdminUser => ({
  id: 'user-2',
  email: 'ana@dts.local',
  displayName: 'Ana Dela Cruz',
  role: 'STAFF_MEMBER',
  divisionId: DIVISION_ID,
  sectionId: SECTION_ID,
  canAccessConfidential: false,
  active: true,
  locked: false,
  lastLoginAt: '2026-09-29T07:30:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-09-29T07:30:00.000Z',
  ...overrides,
});

export const accountRequest = (overrides: Partial<AccountRequest> = {}): AccountRequest => ({
  id: 'request-1',
  email: 'applicant@dts.local',
  displayName: 'Jose Rizal',
  status: 'PENDING',
  requestedDivisionId: DIVISION_ID,
  requestedSectionId: null,
  justification: 'Records intake duties for the Legal Division.',
  reviewedById: null,
  reviewedAt: null,
  rejectionReason: null,
  createdUserId: null,
  createdAt: '2026-09-30T02:15:00.000Z',
  ...overrides,
});

export const auditEvent = (overrides: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 'audit-1',
  actorId: 'user-2',
  action: 'document.workflow.accept',
  targetType: 'document',
  targetId: 'doc-1',
  outcome: 'SUCCESS',
  correlationId: '11111111-2222-4333-8444-555555555555',
  sourceIp: '10.0.0.4',
  summary: { fromStatus: 'PENDING', toStatus: 'IN_PROCESS' },
  occurredAt: '2026-09-30T03:00:00.000Z',
  ...overrides,
});

export const auditPage = (items: AuditEvent[], total = items.length): AuditPage => ({
  items,
  total,
  limit: 50,
  offset: 0,
});

export const division = (overrides: Partial<Division> = {}): Division => ({
  id: DIVISION_ID,
  code: 'REC',
  name: 'Records Division',
  active: true,
  ...overrides,
});

export const section = (overrides: Partial<Section> = {}): Section => ({
  id: SECTION_ID,
  divisionId: DIVISION_ID,
  code: 'INTAKE',
  name: 'Intake',
  active: true,
  ...overrides,
});
