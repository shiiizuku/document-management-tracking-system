import { z } from 'zod';

/**
 * Every workflow status a user sees, filters on, or reads off a badge.
 *
 * This is the one place the vocabulary is written down. It used to be written three times — here,
 * as a `pgEnum` in the API's schema, and as a `const` tuple in `WorkflowService` — with nothing but
 * care keeping them aligned. The database enum and the workflow engine now both derive from this
 * list, so a status cannot exist in one layer and be unknown to another.
 *
 * `PENDING` is a member here and *not* a storable value: ADR-0005 makes it derived from the
 * existence of an unaccepted route, while keeping it a status to users and a filter in lists. See
 * {@link storedWorkflowStatusSchema}.
 */
export const workflowStatusSchema = z.enum([
  'PENDING',
  'IN_PROCESS',
  'FOR_REVISION',
  'FOR_INITIAL',
  'FOR_SIGNATURE',
  'SIGNED',
  'FOR_RELEASE',
  'RELEASED',
  'COMPLIED',
  'ARCHIVED',
]);

/**
 * What `documents.status` may actually hold — the business lifecycle, minus the derived condition.
 *
 * Derived from the presented set rather than listed again (the same shape as
 * {@link fileScanStatusSchema} below), so adding a status above forces a decision about whether it
 * is a stored state or a computed one instead of silently widening the column.
 */
export const storedWorkflowStatusSchema = workflowStatusSchema.exclude(['PENDING']);

export const workflowActionSchema = z.enum([
  'ACCEPT',
  // A for-information copy's counterpart to ACCEPT: the informed division has read it. It takes no
  // custody and never gates progress (ADR-0005, decision 160).
  'ACKNOWLEDGE',
  'REQUEST_REVISION',
  'RESUBMIT',
  'INITIAL',
  'SUBMIT_FOR_SIGNATURE',
  'SIGN',
  'PREPARE_RELEASE',
  'RELEASE',
  'COMPLY',
  'ARCHIVE',
  'RESTORE',
]);
/**
 * `DIRECTOR` is the Regional Director: the sole holder of `DOCUMENT_SIGN` (ADR-0006). It is placed
 * in a division — the ORD — yet reads the whole office, which no other placed role does, because it
 * must review any division's work in order to sign it.
 */
export const roleSchema = z.enum([
  'ADMINISTRATOR',
  'RECORDS_STAFF',
  'DIRECTOR',
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
 * Which roles hold which capabilities is decided on the server. `GET /roles` serves that map to
 * the people who assign roles, so the role picker can describe a role (decision 175 as amended),
 * and that is all the client may use it for: gating on `map[role]` instead of on the session's
 * own array would anticipate the server's answer instead of asking for it.
 */
export const capabilitySchema = z.enum([
  'DOCUMENT_CREATE',
  'DOCUMENT_EDIT',
  'DOCUMENT_ACCEPT',
  'DOCUMENT_REQUEST_REVISION',
  'DOCUMENT_RESUBMIT',
  // A division head's endorsement of an outgoing draft, taken before the Director signs it
  // (ADR-0006). Distinct from DOCUMENT_SIGN, and deliberately held by a different role: if one
  // person holds both, the two-step approval records nothing the one-step version did not.
  'DOCUMENT_INITIAL',
  'DOCUMENT_SUBMIT_FOR_SIGNATURE',
  'DOCUMENT_SIGN',
  'DOCUMENT_PREPARE_RELEASE',
  'DOCUMENT_RELEASE',
  // Recording an incoming document as acted upon, with remarks — its terminal state, and the
  // counterpart to releasing an outgoing one (decision 163).
  'DOCUMENT_COMPLY',
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

/**
 * What one role grants, as `GET /roles` serves it to the people who assign roles (decision 175 as
 * amended). Display data for the role picker and nothing else: gating stays on `/auth/me`.
 *
 * `readsOfficeWide` is the role's read scope, which is not a capability — without it Records Staff
 * and Division Head look nearly identical, when one reads every division and the other its own.
 */
export const roleGrantSchema = z.object({
  role: roleSchema,
  capabilities: z.array(capabilitySchema),
  readsOfficeWide: z.boolean(),
});

export const documentDirectionSchema = z.enum(['INCOMING', 'OUTGOING']);
export const documentPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
/*
 * Release methods are configurable rows, so the wire value is a **code**, not a closed enum
 * (policy register P-15; decision 27 as amended). The office uses LBC and JRS, which a four-value
 * enum could not express, and the list has to be changeable without a migration.
 *
 * The shape is still constrained — upper snake case, so a code reads the same in the database, in
 * a command and in an audit summary — but which codes exist is a question only the database can
 * answer. `DocumentsService` rejects a code with no active row, which is a 400 rather than a
 * schema error; that is the price of configurability and it is paid in exactly one place.
 */
export const releaseMethodCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Release method code must be upper snake case');

/** One configurable release method, as `GET /release-methods` serves it to the release dialog. */
export const releaseMethodSchema = z.object({
  id: z.string(),
  code: releaseMethodCodeSchema,
  label: z.string(),
  /** When true, `trackingReference` is mandatory on a `RELEASE` command using this method. */
  requiresTrackingReference: z.boolean(),
});

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
//
// `DIRECTOR` falls out of the general rule rather than needing a clause of its own: a division is
// required (it belongs to the ORD — ADR-0006) and a section is not. Its office-wide read comes
// from the role, not from the placement, which is why requiring a division costs it nothing.
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
  releaseMethod: releaseMethodCodeSchema.optional(),
  /*
   * Required when the chosen method is flagged `requiresTrackingReference`, refused when it is
   * not: a tracking number against "Picked up" is noise in the record. Both halves of that rule
   * are in `WorkflowService`, because whether it applies depends on a row this schema cannot see.
   */
  trackingReference: z.string().trim().min(1).max(120).optional(),
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

/**
 * How many divisions one forward may copy in for information.
 *
 * A limit rather than none: each entry writes a route row and a notification in the forwarding
 * transaction, and a forward that consults every division in the office is a broadcast, which is
 * not what decision 160 describes.
 */
export const FOR_INFORMATION_RECIPIENT_LIMIT = 10;

// Routing forwards a document to another division (and optionally a section within it) and records
// the hop in the route history. `expectedVersion` keeps it under the same optimistic-concurrency
// check as the other mutations; `divisionId` is a plain string here (the service validates it
// exists/active against Postgres, rejecting a malformed id) to match `createDocumentSchema`.
//
// `toDivisionId`/`toSectionId` name the **lead** recipient: the one that takes custody and on whose
// action the workflow progresses (decision 159). `forInformationDivisionIds` names the rest, who may
// read and remark only. They are division ids and nothing finer because a for-information copy is
// division-level by decision 160 — a section cannot be consulted, only its division.
export const routeDocumentSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    toDivisionId: z.string().trim().min(1),
    toSectionId: z.string().trim().min(1).optional(),
    forInformationDivisionIds: z
      .array(z.string().trim().min(1))
      .max(FOR_INFORMATION_RECIPIENT_LIMIT)
      .optional(),
    remarks: z.string().trim().max(4000).optional(),
  })
  .superRefine((value, context) => {
    const copies = value.forInformationDivisionIds ?? [];
    if (new Set(copies).size !== copies.length) {
      context.addIssue({
        code: 'custom',
        message: 'A division may be copied in only once',
        path: ['forInformationDivisionIds'],
      });
    }
    // The lead already receives the document; naming it again would write a second row for the
    // same division, one of which says the workflow waits on it and one of which says it does not.
    if (copies.includes(value.toDivisionId)) {
      context.addIssue({
        code: 'custom',
        message: 'The lead recipient cannot also be copied in for information',
        path: ['forInformationDivisionIds'],
      });
    }
  });

// Sharing grants one user read access to a document without moving or reassigning it.
export const shareDocumentSchema = z.object({
  userId: z.uuid(),
});

/*
 * Links one incoming document to an outgoing one as a Reference Document (decision 165).
 *
 * **One id per call, deliberately, and not a set.** A batch endpoint would have to decide what
 * happens when three ids are valid and the fourth is unreadable, and under decision 166 every
 * answer to that leaks: partial success tells the caller which id was the bad one, which is
 * precisely the existence oracle the decision forbids. One id per call, each answered with the
 * same indistinguishable 404, has no such seam. A UI that links several loops.
 *
 * Nothing in this feature is named `reference` unqualified: `referenceNumber` is already two
 * different strings (the office's identifier for an outgoing document, the sender's for an
 * incoming one), and `REFERENCES` is a SQL reserved word besides. The relation is spelled out as
 * `referencedDocumentIds` / `replyDocumentIds` wherever it is carried.
 *
 * No `expectedVersion`: linking changes nothing on the document row and bumps no version
 * (decision 179).
 */
export const linkReferenceDocumentSchema = z.object({
  incomingDocumentId: z.uuid(),
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
export type StoredWorkflowStatus = z.infer<typeof storedWorkflowStatusSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type RoleGrant = z.infer<typeof roleGrantSchema>;
export type DocumentDirection = z.infer<typeof documentDirectionSchema>;
export type DocumentPriority = z.infer<typeof documentPrioritySchema>;
export type ReleaseMethodCode = z.infer<typeof releaseMethodCodeSchema>;
export type ReleaseMethod = z.infer<typeof releaseMethodSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentMetadataInput = z.infer<typeof updateDocumentMetadataSchema>;
export type AssignDocumentInput = z.infer<typeof assignDocumentSchema>;
export type RouteDocumentInput = z.infer<typeof routeDocumentSchema>;
export type ShareDocumentInput = z.infer<typeof shareDocumentSchema>;
export type LinkReferenceDocumentInput = z.infer<typeof linkReferenceDocumentSchema>;
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
