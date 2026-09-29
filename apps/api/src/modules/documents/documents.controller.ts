import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import {
  createDocumentSchema,
  workflowActionSchema,
  workflowCommandSchema,
  type CreateDocumentInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { DtsApplicationService } from '../application/dts-application.service.js';
import type { DocumentPriority, DocumentSearchQuery } from './document-search.service.js';
import type { ReleaseMethod, WorkflowStatus } from '../workflow/workflow.service.js';
import { ReportExportService } from '../reports/report-export.service.js';

@Controller('documents')
@UseGuards(AuthGuard)
export class DocumentsController {
  constructor(
    private readonly application: DtsApplicationService,
    private readonly exports: ReportExportService,
  ) {}

  @Get()
  list(@CurrentUser() actor: RequestUser, @Query() query: Record<string, string | undefined>) {
    const searchQuery: DocumentSearchQuery = {
      ...(query.search ? { search: query.search } : {}),
      ...(query.status ? { status: query.status as WorkflowStatus } : {}),
      ...(query.priority ? { priority: query.priority as DocumentPriority } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.direction ? { direction: query.direction as 'INCOMING' | 'OUTGOING' } : {}),
      ...(query.divisionId ? { divisionId: query.divisionId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.sort ? { sort: query.sort as NonNullable<DocumentSearchQuery['sort']> } : {}),
      ...(query.order ? { order: query.order as NonNullable<DocumentSearchQuery['order']> } : {}),
      ...(query.page ? { page: Number(query.page) } : {}),
      ...(query.pageSize ? { pageSize: Number(query.pageSize) } : {}),
    };
    return { data: this.application.searchDocuments(actor, searchQuery) };
  }

  @Post()
  create(
    @CurrentUser() actor: RequestUser,
    @Body(new ZodValidationPipe(createDocumentSchema)) input: CreateDocumentInput,
  ) {
    return { data: this.application.createDocument(actor, input) };
  }

  @Get(':id/routing-slip.pdf')
  async routingSlip(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Res() response: Response,
  ): Promise<void> {
    const document = this.application.getDocument(actor, id);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="routing-slip-${document.trackingNumber}.pdf"`,
    );
    response.send(await this.exports.routingSlip(document, document.timeline));
  }

  @Get(':id')
  detail(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: this.application.getDocument(actor, id) };
  }

  @Get(':id/allowed-actions')
  allowed(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: this.application.allowedActions(actor, id) };
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
    return { data: this.application.executeAction(actor, id, action, input) };
  }

  @Post(':id/assignments')
  assign(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body() input: { recipientUserId: string },
  ) {
    return { data: this.application.assign(actor, id, input.recipientUserId) };
  }
}
