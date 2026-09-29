import type { Request } from 'express';
import type { RequestUser } from './request-user.js';
import type { SessionClaims } from '../modules/auth/session.service.js';

/**
 * What the guards attach to the request. `user` is set by `AuthGuard` and read by the
 * `@CurrentUser()` decorator; `session` carries the verified claims so `CsrfGuard` can check
 * the request header against the token this session was issued with, without re-verifying
 * the JWT.
 */
export interface AuthenticatedRequest extends Request {
  user?: RequestUser;
  session?: SessionClaims;
}
