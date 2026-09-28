import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AuthService } from '../modules/auth/auth.service.js';
import type { RequestUser } from './request-user.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: RequestUser }>();
    const token = request.cookies?.dts_session as string | undefined;
    if (!token) throw new UnauthorizedException('Authentication required');
    let payload: { sub: string };
    try {
      payload = this.jwt.verify<{ sub: string }>(token);
    } catch {
      throw new UnauthorizedException('Session is invalid or expired');
    }
    const user = await this.auth.getUser(payload.sub);
    request.user = user;
    return true;
  }
}
