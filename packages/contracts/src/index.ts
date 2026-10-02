import { z } from 'zod';

export const workflowStatusSchema = z.enum([
  'PENDING',
  'IN_PROCESS',
  'FOR_REVISION',
  'FOR_SIGNATURE',
  'SIGNED',
  'FOR_RELEASE',
  'RELEASED',
  'ARCHIVED',
]);
export const workflowActionSchema = z.enum([
  'ACCEPT',
  'REQUEST_REVISION',
  'RESUBMIT',
  'SUBMIT_FOR_SIGNATURE',
  'SIGN',
  'PREPARE_RELEASE',
  'RELEASE',
  'ARCHIVE',
  'RESTORE',
]);
export const roleSchema = z.enum([
  'ADMINISTRATOR',
  'RECORDS_STAFF',
  'DIVISION_HEAD',
  'STAFF_MEMBER',
  'VIEWER',
]);

/**
 * Every capability the system can grant.
 *
 * Capability — never role — is the unit of authority. The API's role table resolves a signed-in
 * user's role to a subset of this list and returns it from `/auth/me`; the client gates its
 * navigation and controls on that array and never re-derives permission from `role`. Both sides
 * resolving against one enum is what stops a capability from being renamed on the server while a
 * nav item still gates on the old string, or a screen from gating on a capability no role holds.
 *
 * Which roles hold which capabilities deliberately stays on the server (policy register P-11,
 * still provisional): that mapping is a policy decision, and shipping it to the browser would
 * invite the client to anticipate the server's answer instead of asking for it.
 */
export const capabilitySchema = z.enum([
  'DOCUMENT_CREATE',
  'DOCUMENT_EDIT',
  'DOCUMENT_ACCEPT',
  'DOCUMENT_REQUEST_REVISION',
  'DOCUMENT_RESUBMIT',
  'DOCUMENT_SUBMIT_FOR_SIGNATURE',
  'DOCUMENT_SIGN',
  'DOCUMENT_PREPARE_RELEASE',
  'DOCUMENT_RELEASE',
  'DOCUMENT_ARCHIVE',
  'DOCUMENT_DELETE',
  'DOCUMENT_RESTORE',
  'DOCUMENT_ASSIGN',
  'REPORT_VIEW',
  'AUDIT_VIEW',
  'FILE_SCAN_RECORD',
  'USER_MANAGE',
  'ORG_MANAGE',
  'ACCOUNT_REQUEST_REVIEW',
]);

/** The capability names as a list, for exhaustiveness checks over the whole set. */
export const CAPABILITIES = capabilitySchema.options;

export const documentDirectionSchema = z.enum(['INCOMING', 'OUTGOING']);
export const documentPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const releaseMethodSchema = z.enum(['MAILED', 'EMAILED', 'PICKED_UP', 'DELIVERED']);

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(12).max(128),
});

// Applied to every password the system accepts (account requests, admin-created users,
// password changes). Login deliberately reuses only the length bound: rejecting a
// weak-but-correct password at sign-in would lock out accounts created before a policy
// change and would tell an attacker which candidate passwords are worth trying.
export const strongPasswordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .refine((value) => /[a-z]/.test(value), 'Password must contain a lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Password must contain an uppercase letter')
  .refine((value) => /[0-9]/.test(value), 'Password must contain a digit')
  .refine((value) => /[^A-Za-z0-9]/.test(value), 'Password must contain a symbol');

export const accountRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const submitAccountRequestSchema = z.object({
  email: z.email().max(320),
  displayName: z.string().trim().min(1).max(200),
  password: strongPasswordSchema,
  requestedDivisionId: z.uuid().optional(),
  requestedSectionId: z.uuid().optional(),
  justification: z.string().trim().max(2000).optional(),
});

// Roles differ in how much of the organization tree they must be pinned to. Records staff
// and administrators work across the whole office, so their placement is optional; everyone
// else is scoped, and the two lowest roles are scoped all the way down to a section because
// the read policy falls back to a section match for them.
const membershipRules = (
  value: { role: Role; divisionId?: string | undefined; sectionId?: string | undefined },
  context: z.RefinementCtx,
): void => {
  const needsDivision = value.role !== 'ADMINISTRATOR' && value.role !== 'RECORDS_STAFF';
  const needsSection = value.role === 'STAFF_MEMBER' || value.role === 'VIEWER';
  if (needsDivision && !value.divisionId) {
    context.addIssue({
      code: 'custom',
      path: ['divisionId'],
      message: `A division is required for the ${value.role} role`,
    });
  }
  if (needsSection && !value.sectionId) {
    context.addIssue({
      code: 'custom',
      path: ['sectionId'],
      message: `A section is required for the ${value.role} role`,
    });
  }
  if (value.sectionId && !value.divisionId) {
    context.addIssue({
      code: 'custom',
      path: ['divisionId'],
      message: 'A section cannot be assigned without its division',
    });
  }
};

export const approveAccountRequestSchema = z
  .object({
    role: roleSchema,
    divisionId: z.uuid().optional(),
    sectionId: z.uuid().optional(),
    canAccessConfidential: z.boolean().default(false),
  })
  .superRefine(membershipRules);

export const rejectAccountRequestSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const createUserSchema = z
  .object({
    email: z.email().max(320),
    displayName: z.string().trim().min(1).max(200),
    password: strongPasswordSchema,
    role: roleSchema,
    divisionId: z.uuid().optional(),
    sectionId: z.uuid().optional(),
    canAccessConfidential: z.boolean().default(false),
  })
  .superRefine(membershipRules);

// Every field is optional, but the membership rules still apply to the *resulting* user, so
// the service re-checks the merged row. Zod can only reject the shapes that are wrong on
// their face — a section sent without a division.
export const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(200).optional(),
    role: roleSchema.optional(),
    divisionId: z.uuid().nullable().optional(),
    sectionId: z.uuid().nullable().optional(),
    canAccessConfidential: z.boolean().optional(),
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    'At least one field must be supplied',
  );

export const createDivisionSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Code may contain uppercase letters, digits and hyphens only'),
  name: z.string().trim().min(2).max(160),
});
export const updateDivisionSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.active !== undefined,
    'At least one field must be supplied',
  );

export const createSectionSchema = createDivisionSchema.extend({ divisionId: z.uuid() });
export const updateSectionSchema = updateDivisionSchema;

export const listAccountRequestsQuerySchema = z.object({
  status: accountRequestStatusSchema.optional(),
});
export const listUsersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  role: roleSchema.optional(),
  divisionId: z.uuid().optional(),
  active: z.stringbool().optional(),
});

export const createDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    type: z.string().trim().min(1).max(80),
    description: z.string().trim().max(5000).optional(),
    priority: documentPrioritySchema,
    direction: documentDirectionSchema,
    sender: z.string().trim().max(240).optional(),
    company: z.string().trim().max(240).optional(),
    referenceNumber: z.string().trim().max(120).optional(),
    /*
     * A contact address for the document's sender or recipient, kept distinct from
     * `referenceNumber`: that column carries a partial UNIQUE index (one external reference per
     * document), and two documents from the same correspondent legitimately share an email.
     * Empty string is coerced away so an untouched optional field does not fail validation.
     */
    email: z
      .string()
      .trim()
      .max(240)
      .email('Enter a valid email address')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    divisionId: z.string().trim().min(1),
    sectionId: z.string().trim().min(1).optional(),
    confidential: z.boolean().default(false),
    dueAt: z.string().datetime().optional(),
  })
  .superRefine((value, context) => {
    if (value.direction === 'INCOMING' && !value.sender) {
      context.addIssue({
        code: 'custom',
        path: ['sender'],
        message: 'Sender is required for incoming documents',
      });
    }
  });
export const workflowCommandSchema = z.object({
  expectedVersion: z.number().int().positive(),
  remarks: z.string().trim().max(4000).optional(),
  releaseMethod: releaseMethodSchema.optional(),
});

// Metadata edit (`PATCH /documents/:id/metadata`). Only the descriptive fields are editable:
// direction, division and section are structural (they drive reference allocation and access
// scope) and workflow status moves only through the action endpoints, never a metadata patch.
// `expectedVersion` carries the optimistic-concurrency check — a stale edit is a 409, not a
// silent overwrite — and at least one field must actually change.
export const updateDocumentMetadataSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(240).optional(),
    type: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    priority: documentPrioritySchema.optional(),
    sender: z.string().trim().max(240).nullable().optional(),
    company: z.string().trim().max(240).nullable().optional(),
    referenceNumber: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().max(240).email('Enter a valid email address').nullable().optional(),
    confidential: z.boolean().optional(),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) =>
      Object.entries(value).some(
        ([key, field]) => key !== 'expectedVersion' && field !== undefined,
      ),
    'At least one metadata field must be supplied',
  );

export const assignDocumentSchema = z.object({
  recipientUserId: z.uuid(),
});

// Routing forwards a document to another division (and optionally a section within it),
// moving its owning scope and recording the hop in the route history. `expectedVersion` keeps
// it under the same optimistic-concurrency check as the other mutations; `divisionId` is a
// plain string here (the service validates it exists/active against Postgres, rejecting a
// malformed id) to match `createDocumentSchema`.
export const routeDocumentSchema = z.object({
  expectedVersion: z.number().int().positive(),
  toDivisionId: z.string().trim().min(1),
  toSectionId: z.string().trim().min(1).optional(),
  remarks: z.string().trim().max(4000).optional(),
});

// Sharing grants one user read access to a document without moving or reassigning it.
export const shareDocumentSchema = z.object({
  userId: z.uuid(),
});

// Reportable scan outcomes. `PENDING` is intentionally excluded: an already-created
// version starts PENDING, and a scanner may only ever report a resolved outcome — it
// can never push a version back into the pending state (mirrors the domain service's
// `Exclude<FileScanStatus, 'PENDING'>` contract).
/**
 * Every scan state a stored file version can hold, matching the `scan_status` database enum.
 *
 * The client needs the whole set, including `PENDING`: a freshly uploaded version sits there
 * until the scanner reports, and that is precisely the state the UI has to render as "not yet
 * downloadable" rather than fall through as an unrecognised string.
 */
export const scanStatusSchema = z.enum([
  'PENDING',
  'PENDING_RETRY',
  'CLEAN',
  'INFECTED',
  'SCAN_FAILED',
]);

/**
 * What a scanner may report back. Derived from the full set rather than listed again, so a new
 * scan state cannot be added above without a decision about whether a scanner can report it.
 * `PENDING` is excluded because it is the initial state the system assigns, not an outcome.
 */
export const fileScanStatusSchema = scanStatusSchema.exclude(['PENDING']);
export const recordScanSchema = z.object({ status: fileScanStatusSchema });

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type DocumentDirection = z.infer<typeof documentDirectionSchema>;
export type DocumentPriority = z.infer<typeof documentPrioritySchema>;
export type ReleaseMethod = z.infer<typeof releaseMethodSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentMetadataInput = z.infer<typeof updateDocumentMetadataSchema>;
export type AssignDocumentInput = z.infer<typeof assignDocumentSchema>;
export type RouteDocumentInput = z.infer<typeof routeDocumentSchema>;
export type ShareDocumentInput = z.infer<typeof shareDocumentSchema>;
export type ScanStatus = z.infer<typeof scanStatusSchema>;
export type FileScanResult = z.infer<typeof fileScanStatusSchema>;
export type RecordScanInput = z.infer<typeof recordScanSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AccountRequestStatus = z.infer<typeof accountRequestStatusSchema>;
export type SubmitAccountRequestInput = z.infer<typeof submitAccountRequestSchema>;
export type ApproveAccountRequestInput = z.infer<typeof approveAccountRequestSchema>;
export type RejectAccountRequestInput = z.infer<typeof rejectAccountRequestSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateDivisionInput = z.infer<typeof createDivisionSchema>;
export type UpdateDivisionInput = z.infer<typeof updateDivisionSchema>;
export type CreateSectionInput = z.infer<typeof createSectionSchema>;
export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
export type ListAccountRequestsQuery = z.infer<typeof listAccountRequestsQuerySchema>;
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
