import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CsrfGuard } from '../src/common/csrf.guard.js';
import { CSRF_HEADER } from '../src/modules/auth/session.service.js';

const guard = new CsrfGuard();

const context = (request: {
  method: string;
  session?: { csrf: string };
  headers?: Record<string, string | string[]>;
}): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, ...request }) }),
  }) as unknown as ExecutionContext;

const csrf = 'session-bound-token';

describe('CsrfGuard', () => {
  it('allows a safe method without requiring a token', () => {
    expect(guard.canActivate(context({ method: 'GET' }))).toBe(true);
  });

  it('allows a state-changing request whose header matches the session token', () => {
    const request = { method: 'POST', session: { csrf }, headers: { [CSRF_HEADER]: csrf } };

    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('rejects a state-changing request whose header does not match the session token', () => {
    const request = { method: 'POST', session: { csrf }, headers: { [CSRF_HEADER]: 'forged' } };

    expect(() => guard.canActivate(context(request))).toThrow(
      new ForbiddenException('CSRF token missing or invalid'),
    );
  });

  it('rejects a state-changing request that presents no token at all', () => {
    const request = { method: 'POST', session: { csrf } };

    expect(() => guard.canActivate(context(request))).toThrow(
      new ForbiddenException('CSRF token missing or invalid'),
    );
  });

  it('rejects — rather than crashes on — a request that reached it with no session bound', () => {
    // Defence in depth: if the guard ever runs without AuthGuard having populated the session,
    // there is no token to compare against, so it must refuse cleanly instead of throwing on a
    // comparison with an absent expected value.
    const request = { method: 'POST', headers: { [CSRF_HEADER]: 'anything' } };

    expect(() => guard.canActivate(context(request))).toThrow(
      new ForbiddenException('CSRF token missing or invalid'),
    );
  });
});
