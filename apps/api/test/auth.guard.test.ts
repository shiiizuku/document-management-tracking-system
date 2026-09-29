import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../src/common/auth.guard.js';
import { SESSION_COOKIE, SessionService } from '../src/modules/auth/session.service.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';

const jwt = new JwtService({
  secret: 'guard-test-secret-that-is-long-enough',
  signOptions: { expiresIn: 1800 },
});

const config = {
  getOrThrow: (key: string) =>
    ({ COOKIE_MAX_AGE_MS: 1_800_000, SESSION_ABSOLUTE_MAX_AGE_MS: 28_800_000 })[key],
} as unknown as ConfigService;

const sessions = new SessionService(jwt, config);

// A structurally valid session token, so the guard reaches the user lookup rather than
// failing at signature verification.
const validToken = jwt.sign({
  sub: 'user-id',
  csrf: 'csrf-token',
  sst: Math.floor(Date.now() / 1000),
});

const contextWithToken = (token: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ cookies: { [SESSION_COOKIE]: token } }),
      getResponse: () => ({ cookie: vi.fn() }),
    }),
  }) as unknown as ExecutionContext;

describe('AuthGuard', () => {
  it('preserves repository failures instead of disguising them as invalid sessions', async () => {
    const databaseFailure = new Error('database unavailable');
    const auth = { getUser: vi.fn().mockRejectedValue(databaseFailure) } as unknown as AuthService;
    const guard = new AuthGuard(sessions, auth);

    await expect(guard.canActivate(contextWithToken(validToken))).rejects.toBe(databaseFailure);
  });

  it('rejects an invalid JWT as an expired or invalid session', async () => {
    const auth = { getUser: vi.fn() } as unknown as AuthService;
    const guard = new AuthGuard(sessions, auth);

    await expect(guard.canActivate(contextWithToken('not-a-real-token'))).rejects.toThrow(
      new UnauthorizedException('Session is invalid or expired'),
    );
  });
});
