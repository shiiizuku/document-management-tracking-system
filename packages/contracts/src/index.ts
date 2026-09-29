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
export const documentDirectionSchema = z.enum(['INCOMING', 'OUTGOING']);
export const documentPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const releaseMethodSchema = z.enum(['MAILED', 'EMAILED', 'PICKED_UP', 'DELIVERED']);

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12).max(128),
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

// Reportable scan outcomes. `PENDING` is intentionally excluded: an already-created
// version starts PENDING, and a scanner may only ever report a resolved outcome — it
// can never push a version back into the pending state (mirrors the domain service's
// `Exclude<FileScanStatus, 'PENDING'>` contract).
export const fileScanStatusSchema = z.enum(['CLEAN', 'INFECTED', 'SCAN_FAILED', 'PENDING_RETRY']);
export const recordScanSchema = z.object({ status: fileScanStatusSchema });

export type WorkflowStatus = z.infer<typeof workflowStatusSchema>;
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type FileScanResult = z.infer<typeof fileScanStatusSchema>;
export type RecordScanInput = z.infer<typeof recordScanSchema>;
