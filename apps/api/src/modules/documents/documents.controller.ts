import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  assignDocumentSchema,
  createDocumentSchema,
  linkReferenceDocumentSchema,
  listDocumentsQuerySchema,
  recordReleaseCarrierSchema,
  nameSuggestionsQuerySchema,
  routeDocumentSchema,
  shareDocumentSchema,
  updateDocumentMetadataSchema,
  workflowActionSchema,
  workflowCommandSchema,
  type AssignDocumentInput,
  type CreateDocumentInput,
  type LinkReferenceDocumentInput,
  type ListDocumentsQuery,
  type NameSuggestionsQuery,
  type RecordReleaseCarrierInput,
  type RouteDocumentInput,
  type ShareDocumentInput,
  type UpdateDocumentMetadataInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { INLINE_CONTENT_CSP } from '../../common/inline-content.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ReportExportService } from '../reports/report-export.service.js';
import { AuditWriter } from '../audit/audit.writer.js';
import type { ReleaseMethodCode } from '../workflow/workflow.service.js';
import { DocumentsService } from './documents.service.js';
import type { DocumentSearchFilters } from './documents.repository.js';

@Controller('documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly exports: ReportExportService,
    private readonly audit: AuditWriter,
  ) {}

  @Get()
  list(
    @CurrentUser() actor: RequestUser,
    @Query(new ZodValidationPipe(listDocumentsQuerySchema))
    query: Record<string, string | undefined> & ListDocumentsQuery,
  ) {
    const filters: DocumentSearchFilters = {
      ...(query.search ? { search: query.search } : {}),
      ...(query.status ? { status: query.status as DocumentSearchFilters['status'] } : {}),
      ...(query.priority ? { priority: query.priority as DocumentSearchFilters['priority'] } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.direction
        ? { direction: query.direction as DocumentSearchFilters['direction'] }
        : {}),
      ...(query.divisionId ? { divisionId: query.divisionId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.overdue === true ? { overdue: true } : {}),
      ...(query.sort ? { sort: query.sort as NonNullable<DocumentSearchFilters['sort']> } : {}),
      ...(query.order ? { order: query.order as NonNullable<DocumentSearchFilters['order']> } : {}),
      ...(query.page ? { page: Number(query.page) } : {}),
      ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
    };
    // `cursor` and `page` are two ways to ask for the same thing; a numbered page wins, so an old
    // bookmark that still carries `page` behaves as it always did.
    return this.documents
      .search(actor, filters, query.page ? undefined : query.cursor)
      .then((data) => ({ data }));
  }

  @Post()
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createDocumentSchema)) input: CreateDocumentInput,
  ) {
    return this.documents.create(actor, input).then((data) => ({ data }));
  }

  // Declared before the `:id` routes so the literal path is not captured as a document id.
  @Get('assigned')
  assigned(@CurrentUser() actor: RequestUser) {
    return this.documents.assignedQueue(actor).then((data) => ({ data }));
  }

  // Also before `:id`, and for the same reason.
  @Get('suggestions')
  suggestions(
    @CurrentUser() actor: RequestUser,
    @Query(new ZodValidationPipe(nameSuggestionsQuerySchema)) query: NameSuggestionsQuery,
  ) {
    return this.documents.suggestNames(actor, query).then((data) => ({ data }));
  }

  // Also before `:id`, and for the same reason.
  @Get('deleted')
  deleted(@CurrentUser() actor: RequestUser) {
    return this.documents.deletedQueue(actor).then((data) => ({ data }));
  }

  /*
   * The routing slip, twice.
   *
   * Viewing it and exporting it are two audited actions (decision 170), so they are two routes
   * rather than one handler branching on a query parameter. One route per audited action keeps
   * each `audit.write` next to the response it describes, and nothing a caller flips can make a
   * download record itself as a read — which is the whole point of distinguishing them: the
   * question an auditor asks is who took a copy away, not who looked.
   *
   * Neither carries a capability of its own. The slip shows nothing the detail page does not, and
   * `routingSlip` resolves through the same read check, so anyone who can open the document can
   * print its slip — including on a released one, which is exactly the record whose printable
   * dossier people still need.
   */
  @Get(':id/routing-slip/preview.pdf')
  async routingSlipPreview(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const slip = await this.documents.routingSlip(actor, id);
    const content = await this.exports.routingSlip(slip);
    await this.audit.write({
      actorId: actor.id,
      action: 'document.routing-slip-viewed',
      targetType: 'document',
      targetId: id,
      outcome: 'SUCCESS',
      summary: { format: 'pdf' },
    });
    response.setHeader('Content-Type', 'application/pdf');
    // Served with the same headers as the attachment preview. Our own PDF is trusted content, so
    // the sandbox buys nothing here — but the rule has one home, and the cost is nothing.
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', INLINE_CONTENT_CSP);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `inline; filename="routing-slip-${slip.document.trackingNumber}.pdf"`,
    );
    response.send(content);
  }

  @Get(':id/routing-slip.pdf')
  async routingSlip(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const slip = await this.documents.routingSlip(actor, id);
    const content = await this.exports.routingSlip(slip);
    // A copy leaving the system is a different event from reading it on screen. IDs and format
    // only — never the remark text or party names.
    await this.audit.write({
      actorId: actor.id,
      action: 'document.routing-slip-exported',
      targetType: 'document',
      targetId: id,
      outcome: 'SUCCESS',
      summary: { format: 'pdf' },
    });
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="routing-slip-${slip.document.trackingNumber}.pdf"`,
    );
    response.send(content);
  }

  @Get(':id')
  detail(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return this.documents.getDocument(actor, id).then((data) => ({ data }));
  }

  @Get(':id/metadata-revisions')
  metadataRevisions(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return this.documents.metadataHistory(actor, id).then((data) => ({ data }));
  }

  @Patch(':id/metadata')
  editMetadata(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDocumentMetadataSchema)) input: UpdateDocumentMetadataInput,
  ) {
    return this.documents.editMetadata(actor, id, input).then((data) => ({ data }));
  }

  @Get(':id/allowed-actions')
  allowed(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return this.documents.allowedActions(actor, id).then((data) => ({ data }));
  }

  @Post(':id/actions/:action')
  action(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Param('action') rawAction: string,
    @Body(new ZodValidationPipe(workflowCommandSchema))
    input: {
      expectedVersion: number;
      remarks?: string;
      releaseMethod?: ReleaseMethodCode;
      releaseCarrier?: ReleaseMethodCode;
      trackingReference?: string;
    },
  ) {
    const action = workflowActionSchema.parse(rawAction);
    return this.documents.executeAction(actor, id, action, input).then((data) => ({ data }));
  }

  // Records staff filling in the carrier of a mailed release recorded before carriers existed.
  @Post(':id/release/carrier')
  recordReleaseCarrier(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(recordReleaseCarrierSchema)) input: RecordReleaseCarrierInput,
  ) {
    return this.documents.recordReleaseCarrier(actor, id, input).then((data) => ({ data }));
  }

  @Post(':id/assignments')
  assign(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(assignDocumentSchema)) input: AssignDocumentInput,
  ) {
    return this.documents.assign(actor, id, input.recipientUserId).then((data) => ({ data }));
  }

  @Post(':id/routes')
  route(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(routeDocumentSchema)) input: RouteDocumentInput,
  ) {
    return this.documents.route(actor, id, input).then((data) => ({ data }));
  }

  /*
   * Reference Documents (decisions 165–167). One id per call rather than a set, because a batch has
   * to report which of several ids was the bad one and under decision 166 that report is the leak —
   * see `linkReferenceDocumentSchema`. No `expectedVersion` in the body and none in the response's
   * version either (decision 179).
   */
  @Post(':id/references')
  linkReference(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(linkReferenceDocumentSchema)) input: LinkReferenceDocumentInput,
  ) {
    return this.documents
      .linkReferenceDocument(actor, id, input.incomingDocumentId)
      .then((data) => ({ data }));
  }

  /*
   * The target id is a path parameter here, so it is validated by the same field schema the body
   * uses on the way in — reusing the field rather than restating `z.uuid()` keeps the two halves of
   * one feature from drifting. A malformed value has to be refused as a bad request rather than
   * reaching Postgres as an invalid-uuid cast, which would answer 500 where every other miss
   * answers 404.
   */
  @Delete(':id/references/:incomingDocumentId')
  unlinkReference(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Param(
      'incomingDocumentId',
      new ZodValidationPipe(linkReferenceDocumentSchema.shape.incomingDocumentId),
    )
    incomingDocumentId: string,
  ) {
    return this.documents
      .unlinkReferenceDocument(actor, id, incomingDocumentId)
      .then((data) => ({ data }));
  }

  @Post(':id/shares')
  share(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(shareDocumentSchema)) input: ShareDocumentInput,
  ) {
    return this.documents.share(actor, id, input.userId).then((data) => ({ data }));
  }

  // Logical deletion carries `expectedVersion` in the body (same optimistic-concurrency guard as
  // the other mutations), so `workflowCommandSchema` is reused for its `expectedVersion` field.
  @Delete(':id')
  remove(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(workflowCommandSchema)) input: { expectedVersion: number },
  ) {
    return this.documents.softDelete(actor, id, input.expectedVersion).then((data) => ({ data }));
  }

  @Post(':id/restore')
  restore(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(workflowCommandSchema)) input: { expectedVersion: number },
  ) {
    return this.documents.restore(actor, id, input.expectedVersion).then((data) => ({ data }));
  }
}
