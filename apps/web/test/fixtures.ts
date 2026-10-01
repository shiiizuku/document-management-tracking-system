import type { AttachmentGroup, AttachmentVersion } from '../src/features/attachments/queries';
import type { DocumentDetail, DocumentListItem } from '../src/features/documents/queries';
import type { Notification } from '../src/features/notifications/queries';
import type { MonthlyReport } from '../src/features/reports/queries';
import type { SessionUser } from '../src/features/session/queries';

/**
 * Wire-shaped fixtures, built with every field the API actually sends.
 *
 * Partial objects cast into place would let a screen read a field no fixture sets, so a missing
 * field would surface as `undefined` in a passing test rather than as a type error here.
 */

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
  title: 'Incoming budget letter',
  type: 'LETTER',
  description: 'Covering letter for the quarterly budget submission.',
  priority: 'NORMAL',
  direction: 'INCOMING',
  status: 'PENDING',
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

export const documentDetail = (overrides: Partial<DocumentDetail> = {}): DocumentDetail => ({
  ...documentItem(),
  assigneeUserIds: [],
  sharedUserIds: [],
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
