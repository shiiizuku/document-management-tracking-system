import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { DtsApplicationService } from '../modules/application/dts-application.service.js';
import type { RequestUser } from './request-user.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly application: DtsApplicationService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const token = request.cookies?.dts_session as string | undefined;
    if (!token) throw new UnauthorizedException('Authentication required');
    try {
      const payload = this.jwt.verify<{ sub: string }>(token);
      const user = this.application.getUser(payload.sub);
      if (!user.active) throw new UnauthorizedException('Account is inactive');
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Session is invalid or expired');
    }
  }
}
