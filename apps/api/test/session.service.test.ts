import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SessionService,
} from '../src/modules/auth/session.service.js';

const IDLE_MS = 30 * 60 * 1000;
const ABSOLUTE_MS = 60 * 60 * 1000;

const jwt = new JwtService({
  secret: 'session-test-secret-that-is-long-enough',
  signOptions: { expiresIn: IDLE_MS / 1000 },
});

const config = {
  getOrThrow: (key: string) =>
    ({ COOKIE_MAX_AGE_MS: IDLE_MS, SESSION_ABSOLUTE_MAX_AGE_MS: ABSOLUTE_MS })[key],
} as unknown as ConfigService;

const service = new SessionService(jwt, config);
const nowSeconds = () => Math.floor(Date.now() / 1000);

describe('SessionService.verify', () => {
  it('accepts a freshly signed session and returns its claims', () => {
    const token = jwt.sign({ sub: 'user-1', csrf: 'csrf-1', sst: nowSeconds() });

    expect(service.verify(token)).toMatchObject({ sub: 'user-1', csrf: 'csrf-1' });
  });

  it('rejects a session past its absolute cap even while the inactivity window is open', () => {
    // Signed just now (so `exp` is in the future and the inactivity check passes) but claiming
    // a sign-in time older than the absolute cap: renewal must never extend a session forever.
    const startedTooLongAgo = nowSeconds() - ABSOLUTE_MS / 1000 - 60;
    const token = jwt.sign({ sub: 'user-1', csrf: 'csrf-1', sst: startedTooLongAgo });

    expect(() => service.verify(token)).toThrow(
      new UnauthorizedException('Session is invalid or expired'),
    );
  });

  it('rejects a token that carries no CSRF claim', () => {
    const token = jwt.sign({ sub: 'user-1', sst: nowSeconds() });

    expect(() => service.verify(token)).toThrow(
      new UnauthorizedException('Session is invalid or expired'),
    );
  });
});

describe('SessionService cookies', () => {
  const fakeResponse = () => ({ cookie: vi.fn(), clearCookie: vi.fn() });

  it('issues a session that carries an inactivity max-age and stays server-only', () => {
    const response = fakeResponse();
    service.issue(response as unknown as Response, 'user-1', 0);

    const session = response.cookie.mock.calls.find((call) => call[0] === SESSION_COOKIE);
    expect(session?.[2]).toMatchObject({ httpOnly: true, maxAge: IDLE_MS, path: '/' });
    // The CSRF mirror must be readable by the SPA, so it is deliberately not http-only.
    const csrf = response.cookie.mock.calls.find((call) => call[0] === CSRF_COOKIE);
    expect(csrf?.[2]).toMatchObject({ httpOnly: false });
  });

  it('carries the session version it was issued under, and keeps it on renewal', () => {
    const issued = fakeResponse();
    service.issue(issued as unknown as Response, 'user-1', 5);
    const token = issued.cookie.mock.calls.find(
      (call) => call[0] === SESSION_COOKIE,
    )?.[1] as string;
    const claims = service.verify(token);
    expect(claims.sv).toBe(5);

    const renewed = fakeResponse();
    service.renew(renewed as unknown as Response, claims);
    const renewedToken = renewed.cookie.mock.calls.find(
      (call) => call[0] === SESSION_COOKIE,
    )?.[1] as string;
    expect(service.verify(renewedToken)).toMatchObject({ sub: 'user-1', sv: 5, csrf: claims.csrf });
  });

  it('clears both cookies on logout with flags that match how they were set', () => {
    const response = fakeResponse();
    service.clear(response as unknown as Response);

    const cleared = response.clearCookie.mock.calls;
    const session = cleared.find((call) => call[0] === SESSION_COOKIE);
    const csrf = cleared.find((call) => call[0] === CSRF_COOKIE);
    // A clear whose flags do not mirror the set flags silently leaves the cookie in place, so
    // http-only, path and same-site must match; max-age is the one flag clearCookie owns.
    expect(session?.[1]).toMatchObject({ httpOnly: true, path: '/' });
    expect(session?.[1]).not.toHaveProperty('maxAge');
    expect(csrf?.[1]).toMatchObject({ httpOnly: false, path: '/' });
    expect(csrf).toBeDefined();
  });
});
