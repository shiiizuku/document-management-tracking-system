import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { AuthorizationService } from '../authorization/authorization.service.js';

/**
 * The audit trail reader. `GET /users` used to live here gated on `DOCUMENT_ASSIGN`, which
 * meant anyone who could route a document could read the whole directory; it is now split
 * between `GET /users` (administrators, full projection) and `GET /users/assignable` (the
 * picker's narrow, scoped projection) in `UsersController`.
 */
@Controller()
@UseGuards(AuthGuard, CsrfGuard)
export class AdminController {
  constructor(
    private readonly audit: AuditWriter,
    private readonly authorization: AuthorizationService,
  ) {}

  @Get('audit-events')
  async auditEvents(
    @CurrentUser() actor: RequestUser,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('limit') limit?: string,
  ) {
    this.authorization.assert(actor, 'audit-event:list');
    const parsed = limit === undefined ? undefined : Number.parseInt(limit, 10);
    return {
      data: await this.audit.list({
        ...(actorId === undefined ? {} : { actorId }),
        ...(action === undefined ? {} : { action }),
        ...(parsed === undefined || Number.isNaN(parsed) ? {} : { limit: parsed }),
      }),
    };
  }
}
