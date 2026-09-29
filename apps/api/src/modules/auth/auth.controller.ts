import { Body, Controller, Get, HttpCode, Ip, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { loginSchema, type LoginInput } from '@dts/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { AuthService } from './auth.service.js';
import { SessionService } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Rate limited harder than the rest of the API (decision register 68). The per-account
   * lockout in `AuthService` stops a sustained attack on one address; this stops one client
   * spraying a common password across many addresses, which no per-account counter sees.
   */
  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Ip() sourceIp: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.auth.authenticate(body.email, body.password, sourceIp);
    this.sessions.issue(response, user.id);
    return { data: user };
  }

  /**
   * Guarded, unlike the previous stateless version: the audit trail needs to name who logged
   * out, and clearing a cookie for an unauthenticated caller achieves nothing anyway. No CSRF
   * guard — being logged out by a forged request is a nuisance, not a breach, and demanding
   * the header would leave a user with a half-broken session unable to clear it.
   */
  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @CurrentUser() actor: RequestUser,
    @Ip() sourceIp: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    this.sessions.clear(response);
    await this.auth.recordLogout(actor.id, sourceIp);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: RequestUser) {
    return { data: user };
  }
}
