import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare } from 'bcryptjs';
import type { RequestUser } from '../../common/request-user.js';
import { AuditWriter, pseudonymizeEmail } from '../audit/audit.writer.js';
import { capabilitiesByRole } from '../authorization/role-capabilities.js';
import { UsersRepository, type UserRow } from '../users/users.repository.js';

// A real bcrypt hash of a value nobody knows. Comparing against it when no user matched keeps
// the response time for an unknown address indistinguishable from a wrong password, so login
// cannot be used to enumerate which addresses have accounts (decision register 97).
const DUMMY_PASSWORD_HASH = '$2b$12$oMsRoE0SMBoLdJCuWFrKuOosX2xBsOEyKVW/yzvBL2e3yJee9CSA2';

// One message for every failure mode: unknown address, wrong password, deactivated account,
// locked account. Anything more specific tells an attacker which half of a guess was right.
const INVALID_CREDENTIALS = 'Invalid email or password';

type FailureReason =
  | 'UNKNOWN_ACCOUNT'
  | 'INVALID_PASSWORD'
  | 'ACCOUNT_INACTIVE'
  | 'ACCOUNT_LOCKED';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditWriter,
    private readonly config: ConfigService,
  ) {}

  async authenticate(email: string, password: string, sourceIp?: string): Promise<RequestUser> {
    const user = await this.users.findByEmail(email);
    const locked = user !== null && user.lockedUntil !== null && user.lockedUntil > new Date();

    // Always run one bcrypt comparison, whatever happens next, so the work done is the same
    // for a locked account, an unknown address and a wrong password.
    const passwordMatches = await compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    if (user === null) {
      await this.recordFailure(null, 'UNKNOWN_ACCOUNT', sourceIp, {
        emailHash: pseudonymizeEmail(email),
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    // Checked before the password verdict: while an account is locked a correct password must
    // fail too, otherwise the lockout only slows down attackers who are still guessing wrong.
    if (locked) {
      await this.recordFailure(user.id, 'ACCOUNT_LOCKED', sourceIp);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!user.active) {
      await this.recordFailure(user.id, 'ACCOUNT_INACTIVE', sourceIp);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (!passwordMatches) {
      const { lockedUntil } = await this.users.registerFailedLogin(
        user.id,
        this.config.getOrThrow<number>('LOGIN_MAX_ATTEMPTS'),
        this.config.getOrThrow<number>('LOGIN_LOCKOUT_MS'),
      );
      await this.recordFailure(user.id, 'INVALID_PASSWORD', sourceIp, {
        locked: lockedUntil !== null && lockedUntil > new Date(),
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    await this.users.recordSuccessfulLogin(user.id);
    await this.audit.write({
      actorId: user.id,
      action: 'auth.login',
      targetType: 'user',
      targetId: user.id,
      outcome: 'SUCCESS',
      sourceIp: sourceIp ?? null,
    });
    return this.toRequestUser(user);
  }

  async getUser(id: string): Promise<RequestUser> {
    const user = await this.users.findById(id);
    if (user === null) throw new UnauthorizedException('User no longer exists');
    if (!user.active) throw new UnauthorizedException('Account is inactive');
    return this.toRequestUser(user);
  }

  async recordLogout(actorId: string, sourceIp?: string): Promise<void> {
    await this.audit.write({
      actorId,
      action: 'auth.logout',
      targetType: 'user',
      targetId: actorId,
      outcome: 'SUCCESS',
      sourceIp: sourceIp ?? null,
    });
  }

  /**
   * The audit row carries the reason the caller was never told, which is the point: operators
   * investigating an incident need to distinguish a forgotten password from an attack, while
   * the HTTP response stays uniform. The summary holds a reason code and — for an unknown
   * address — a truncated digest, never the address itself or the password (P-14, decision 98).
   */
  private async recordFailure(
    actorId: string | null,
    reason: FailureReason,
    sourceIp?: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await this.audit.write({
      actorId,
      action: 'auth.login',
      targetType: 'user',
      targetId: actorId ?? 'unknown',
      outcome: 'FAILURE',
      sourceIp: sourceIp ?? null,
      summary: { reason, ...extra },
    });
  }

  private toRequestUser(user: UserRow): RequestUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      divisionId: user.divisionId,
      sectionId: user.sectionId,
      capabilities: capabilitiesByRole[user.role],
      canAccessConfidential: user.canAccessConfidential,
      active: user.active,
    };
  }
}
