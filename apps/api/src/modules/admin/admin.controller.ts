import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { DtsApplicationService } from '../application/dts-application.service.js';

@Controller()
@UseGuards(AuthGuard)
export class AdminController {
  constructor(private readonly application: DtsApplicationService) {}
  @Get('users') users(@CurrentUser() actor: RequestUser) {
    return { data: this.application.listUsers(actor) };
  }
  @Get('audit-events') audit(@CurrentUser() actor: RequestUser) {
    return { data: this.application.auditEvents(actor) };
  }
}
