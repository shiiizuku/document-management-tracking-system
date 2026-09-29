import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { loginSchema } from '@dts/contracts';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { AuthService } from './auth.service.js';
import type { CookieSameSite } from '../../config/environment.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string },
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.auth.authenticate(body.email, body.password);
    const token = this.jwt.sign({ sub: user.id });
    response.cookie('dts_session', token, {
      httpOnly: true,
      sameSite: this.config.getOrThrow<CookieSameSite>('COOKIE_SAME_SITE'),
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      maxAge: this.config.getOrThrow<number>('COOKIE_MAX_AGE_MS'),
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
