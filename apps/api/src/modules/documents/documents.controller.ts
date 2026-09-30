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
  routeDocumentSchema,
  shareDocumentSchema,
  updateDocumentMetadataSchema,
  workflowActionSchema,
  workflowCommandSchema,
  type AssignDocumentInput,
  type CreateDocumentInput,
  type RouteDocumentInput,
  type ShareDocumentInput,
  type UpdateDocumentMetadataInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { ReportExportService } from '../reports/report-export.service.js';
import { AuditWriter } from '../audit/audit.writer.js';
import type { ReleaseMethod } from '../workflow/workflow.service.js';
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
  list(@CurrentUser() actor: RequestUser, @Query() query: Record<string, string | undefined>) {
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
      ...(query.sort ? { sort: query.sort as NonNullable<DocumentSearchFilters['sort']> } : {}),
      ...(query.order ? { order: query.order as NonNullable<DocumentSearchFilters['order']> } : {}),
      ...(query.page ? { page: Number(query.page) } : {}),
      ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
    };
    return this.documents.search(actor, filters).then((data) => ({ data }));
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

  @Get(':id/routing-slip.pdf')
  async routingSlip(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const document = await this.documents.getDocument(actor, id);
    const content = await this.exports.routingSlip(document, document.timeline);
    // The routing slip is a printable dossier (title, status, full timeline with remarks) that
    // leaves the system as a file, so its export is audited even though the on-screen detail read
    // is not. IDs and format only — never the remark text or party names.
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
      `attachment; filename="routing-slip-${document.trackingNumber}.pdf"`,
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
    input: { expectedVersion: number; remarks?: string; releaseMethod?: ReleaseMethod },
  ) {
    const action = workflowActionSchema.parse(rawAction);
    return this.documents.executeAction(actor, id, action, input).then((data) => ({ data }));
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
