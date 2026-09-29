import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { CSRF_HEADER } from '../modules/auth/session.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

// Methods that must not change state, so a cross-site GET cannot do damage and does not need
// a token. Anything else — POST, PATCH, PUT, DELETE — does.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const matches = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` throws on a length mismatch, and the lengths themselves are not secret.
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Double-submit CSRF, bound to the session rather than to a standalone cookie.
 *
 * The token lives in the session JWT and is mirrored in a JS-readable cookie that the SPA
 * copies into `X-CSRF-Token`. Because the guard compares the header to the *signed claim*,
 * an attacker who can write cookies for the site — a sibling subdomain, say — cannot simply
 * plant a matching pair: they would also have to mint a signed session carrying that token.
 *
 * Always used after `AuthGuard`, which is what puts the verified claims on the request.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const expected = request.session?.csrf;
    if (expected === undefined) throw new ForbiddenException('CSRF token missing or invalid');
    const header = request.headers[CSRF_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;
    if (typeof presented !== 'string' || !matches(presented, expected))
      throw new ForbiddenException('CSRF token missing or invalid');
    return true;
  }
}
