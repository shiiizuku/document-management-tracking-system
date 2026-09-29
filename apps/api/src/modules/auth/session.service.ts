import { randomBytes } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CookieOptions, Response } from 'express';
import type { CookieSameSite } from '../../config/environment.js';

export const SESSION_COOKIE = 'dts_session';
export const CSRF_COOKIE = 'dts_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface SessionClaims {
  /** The authenticated user's ID. */
  sub: string;
  /** The CSRF token this session is bound to; mirrored in the readable `dts_csrf` cookie. */
  csrf: string;
  /** Session start, epoch seconds. Anchors the absolute cap across renewals. */
  sst: number;
  /** Set by `jsonwebtoken` from the module's `expiresIn`; the inactivity deadline. */
  exp: number;
}

/**
 * Owns the session cookie pair and the rules about when a session is still good. Login,
 * renewal inside `AuthGuard` and logout all go through here so the three can never disagree
 * about cookie flags, claim shape or lifetimes.
 *
 * Sessions remain stateless JWTs (ADR-0002). Two claims make that survivable: `csrf` binds a
 * required request header to the session, and `sst` pins the original sign-in time so sliding
 * renewal cannot extend a session indefinitely.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  private get idleWindowMs(): number {
    return this.config.getOrThrow<number>('COOKIE_MAX_AGE_MS');
  }

  private get absoluteWindowMs(): number {
    return this.config.getOrThrow<number>('SESSION_ABSOLUTE_MAX_AGE_MS');
  }

  // `includeMaxAge` is dropped for `clearCookie`, which sets its own expiry: the remaining
  // flags must still mirror the ones used to set the cookie, or the clear silently misses it.
  private cookieOptions(httpOnly: boolean, includeMaxAge = true): CookieOptions {
    return {
      httpOnly,
      sameSite: this.config.getOrThrow<CookieSameSite>('COOKIE_SAME_SITE'),
      secure: this.config.getOrThrow<boolean>('COOKIE_SECURE'),
      ...(includeMaxAge ? { maxAge: this.idleWindowMs } : {}),
      path: '/',
    };
  }

  /** Starts a new session: fresh CSRF token, absolute-cap clock reset to now. */
  issue(response: Response, userId: string): void {
    this.write(response, {
      sub: userId,
      csrf: randomBytes(32).toString('base64url'),
      sst: Math.floor(Date.now() / 1000),
    });
  }

  /**
   * Extends the inactivity window while preserving the CSRF binding and the original sign-in
   * time, so a user who keeps working is not logged out mid-task but the absolute cap still
   * lands when it was always going to.
   */
  renew(response: Response, claims: SessionClaims): void {
    this.write(response, { sub: claims.sub, csrf: claims.csrf, sst: claims.sst });
  }

  clear(response: Response): void {
    response.clearCookie(SESSION_COOKIE, this.cookieOptions(true, false));
    response.clearCookie(CSRF_COOKIE, this.cookieOptions(false, false));
  }

  /**
   * Verifies the signature and the inactivity window (`jsonwebtoken` checks `exp`), then the
   * absolute cap. Every failure is reported identically: which of the two windows elapsed is
   * not something a caller needs, and saying so tells an attacker holding a stale token
   * whether the account is still being used.
   */
  verify(token: string): SessionClaims {
    let claims: SessionClaims;
    try {
      claims = this.jwt.verify<SessionClaims>(token);
    } catch {
      throw new UnauthorizedException('Session is invalid or expired');
    }
    if (typeof claims.sub !== 'string' || typeof claims.csrf !== 'string')
      throw new UnauthorizedException('Session is invalid or expired');
    const startedMs = (claims.sst ?? 0) * 1000;
    if (Date.now() - startedMs > this.absoluteWindowMs)
      throw new UnauthorizedException('Session is invalid or expired');
    return claims;
  }

  /**
   * True once more than half the inactivity window has been used. Renewing on every request
   * would rewrite the cookie on every poll for no benefit; renewing at the halfway mark keeps
   * an active user signed in with at most one extra `Set-Cookie` per half-window.
   */
  shouldRenew(claims: SessionClaims): boolean {
    const remainingMs = claims.exp * 1000 - Date.now();
    return remainingMs < this.idleWindowMs / 2;
  }

  private write(response: Response, claims: Omit<SessionClaims, 'exp'>): void {
    const token = this.jwt.sign(claims);
    response.cookie(SESSION_COOKIE, token, this.cookieOptions(true));
    // Readable by the browser on purpose: the SPA copies it into the `X-CSRF-Token` header.
    // A same-site attacker cannot read it cross-origin, and a cross-site attacker who can
    // make the browser send the session cookie still cannot read this one to set the header.
    response.cookie(CSRF_COOKIE, claims.csrf, this.cookieOptions(false));
  }
}
