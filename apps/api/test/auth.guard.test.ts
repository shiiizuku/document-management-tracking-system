import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { AuthGuard } from '../src/common/auth.guard.js';
import type { AuthService } from '../src/modules/auth/auth.service.js';

const contextWithToken = (token: string): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ cookies: { dts_session: token } }),
    }),
  }) as unknown as ExecutionContext;

describe('AuthGuard', () => {
  it('preserves repository failures instead of disguising them as invalid sessions', async () => {
    const databaseFailure = new Error('database unavailable');
    const jwt = { verify: vi.fn().mockReturnValue({ sub: 'user-id' }) } as unknown as JwtService;
    const auth = { getUser: vi.fn().mockRejectedValue(databaseFailure) } as unknown as AuthService;
    const guard = new AuthGuard(jwt, auth);

    await expect(guard.canActivate(contextWithToken('valid-token'))).rejects.toBe(databaseFailure);
  });

  it('rejects an invalid JWT as an expired or invalid session', async () => {
    const jwt = {
      verify: vi.fn().mockImplementation(() => {
        throw new Error('invalid token');
      }),
    } as unknown as JwtService;
    const auth = { getUser: vi.fn() } as unknown as AuthService;
    const guard = new AuthGuard(jwt, auth);

    await expect(guard.canActivate(contextWithToken('invalid-token'))).rejects.toThrow(
      new UnauthorizedException('Session is invalid or expired'),
    );
  });
});
