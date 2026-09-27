import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Response } from 'express';
import { loginSchema } from '@dts/contracts';
import { DtsApplicationService } from '../application/dts-application.service.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly application: DtsApplicationService,
    private readonly jwt: JwtService,
  ) {}

  @Post('login')
  login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = this.application.authenticate(body.email, body.password);
    const token = this.jwt.sign({ sub: user.id });
    response.cookie('dts_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 60 * 1000,
      path: '/',
    });
    return { data: user };
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response): void {
    response.clearCookie('dts_session', { path: '/' });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: RequestUser) {
    return { data: user };
  }
}
