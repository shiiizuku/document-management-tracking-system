import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
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
    // `user` is the documented query name (Phase 6 spec: `?user=&action=&from=&to=`); `actorId`
    // is kept as an alias so existing callers don't break. `user` wins if both are supplied.
    @Query('user') user?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.authorization.assert(actor, 'audit-event:list');
    const resolvedActor = user ?? actorId;
    return {
      data: await this.audit.list({
        ...(resolvedActor === undefined ? {} : { actorId: resolvedActor }),
        ...(action === undefined ? {} : { action }),
        ...(from === undefined ? {} : { from: this.parseInstant('from', from) }),
        ...(to === undefined ? {} : { to: this.parseInstant('to', to) }),
        ...this.parseCount('limit', limit),
        ...this.parseCount('offset', offset),
      }),
    };
  }

  /** Parse an ISO-8601 date/datetime query param, rejecting anything unparseable with a 400. */
  private parseInstant(field: string, value: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()))
      throw new BadRequestException(`"${field}" must be an ISO-8601 date`);
    return parsed;
  }

  /** Parse a non-negative integer query param; a missing or malformed value is simply omitted. */
  private parseCount(field: 'limit' | 'offset', value?: string): Record<string, number> {
    if (value === undefined) return {};
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed < 0)
      throw new BadRequestException(`"${field}" must be a non-negative integer`);
    return { [field]: parsed };
  }
}
