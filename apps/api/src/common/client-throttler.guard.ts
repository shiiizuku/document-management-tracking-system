import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  normalizeIp,
  type ThrottlerGetTrackerFunction,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { SessionService, SESSION_COOKIE } from '../modules/auth/session.service.js';

/**
 * Keys a bucket on the client address. `req.ip` is only as good as Express's `trust proxy`
 * setting (`TRUST_PROXY`): behind the pilot's ingress it is the real client once that is set,
 * and the ingress for everyone until it is.
 */
const clientIpKey = (req: Record<string, unknown>): string =>
  `ip:${normalizeIp(typeof req.ip === 'string' ? req.ip : '')}`;

export const clientIpTracker: ThrottlerGetTrackerFunction = (req) => clientIpKey(req);

/**
 * The global rate limiter, keyed on *who* is calling rather than only *where from*.
 *
 * A request carrying a valid session is counted against its user, so colleagues sharing an
 * office NAT or one ingress hop do not share one 120/min budget. Anything else — no cookie, or
 * one that fails verification — falls back to the client address. The session is verified here
 * because global guards run before the per-controller `AuthGuard`; a forged or expired cookie
 * therefore buys no bucket of its own.
 *
 * Unauthenticated routes that defend against credential spraying (login, account requests)
 * pin {@link clientIpTracker} in their `@Throttle`, so holding someone's session cannot move
 * an attacker's guesses into a fresh per-user bucket.
 */
@Injectable()
export class ClientThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly sessions: SessionService,
  ) {
    super(options, storageService, reflector);
  }

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    const cookies = req.cookies as Record<string, unknown> | undefined;
    const token = cookies?.[SESSION_COOKIE];
    if (typeof token === 'string' && token !== '') {
      try {
        return Promise.resolve(`user:${this.sessions.verify(token).sub}`);
      } catch {
        // Not a session we issued, or no longer a live one: count it as the client it came from.
      }
    }
    return Promise.resolve(clientIpKey(req));
  }
}
