import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { DocumentsService } from '../documents/documents.service.js';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('summary')
  async summary(@CurrentUser() actor: RequestUser) {
    return { data: await this.documents.dashboardSummary(actor) };
  }
}
