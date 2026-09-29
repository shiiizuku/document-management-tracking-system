import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from '../modules/auth/auth.service.js';
import { SessionService, SESSION_COOKIE } from '../modules/auth/session.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) throw new UnauthorizedException('Authentication required');

    const claims = this.sessions.verify(token);
    // Re-read the user on every request rather than trusting the token's copy, so a
    // deactivation or a role change takes effect immediately even though the session itself
    // is stateless and cannot be revoked (decision register 93).
    const user = await this.auth.getUser(claims.sub);
    request.user = user;
    request.session = claims;

    // Sliding inactivity window (policy register P-10): a user who is still working keeps
    // their session, a user who walks away loses it.
    if (this.sessions.shouldRenew(claims)) {
      this.sessions.renew(http.getResponse<Response>(), claims);
    }
    return true;
  }
}
