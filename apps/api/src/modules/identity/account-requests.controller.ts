import { Body, Controller, Get, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  approveAccountRequestSchema,
  listAccountRequestsQuerySchema,
  rejectAccountRequestSchema,
  submitAccountRequestSchema,
  type ApproveAccountRequestInput,
  type ListAccountRequestsQuery,
  type RejectAccountRequestInput,
  type SubmitAccountRequestInput,
} from '@dts/contracts';
import { AuthGuard } from '../../common/auth.guard.js';
import { clientIpTracker } from '../../common/client-throttler.guard.js';
import { CsrfGuard } from '../../common/csrf.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { IdentityService } from './identity.service.js';

@Controller('account-requests')
export class AccountRequestsController {
  constructor(private readonly identity: IdentityService) {}

  /**
   * The one write endpoint with no session, so it is the one that needs the tightest rate
   * limit: without it the form is a free bcrypt-per-request CPU sink and a way to flood the
   * review queue. Deliberately outside `AuthGuard`/`CsrfGuard` — there is no session to bind
   * a CSRF token to, and a forged submission achieves nothing an attacker could not do by
   * posting the form themselves.
   */
  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000, getTracker: clientIpTracker } })
  async submit(
    @Body(new ZodValidationPipe(submitAccountRequestSchema)) input: SubmitAccountRequestInput,
    @Ip() sourceIp: string,
  ) {
    return { data: await this.identity.submitAccountRequest(input, sourceIp) };
  }

  @Get()
  @UseGuards(AuthGuard, CsrfGuard)
  async list(
    @CurrentUser() actor: RequestUser,
    @Query(new ZodValidationPipe(listAccountRequestsQuerySchema)) query: ListAccountRequestsQuery,
  ) {
    return { data: await this.identity.listAccountRequests(actor, query.status) };
  }

  @Post(':id/approve')
  @UseGuards(AuthGuard, CsrfGuard)
  async approve(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(approveAccountRequestSchema)) input: ApproveAccountRequestInput,
  ) {
    return { data: await this.identity.approveAccountRequest(actor, id, input) };
  }

  @Post(':id/reject')
  @UseGuards(AuthGuard, CsrfGuard)
  async reject(
    @CurrentUser() actor: RequestUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectAccountRequestSchema)) input: RejectAccountRequestInput,
  ) {
    return { data: await this.identity.rejectAccountRequest(actor, id, input) };
  }
}
