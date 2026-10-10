import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { compare, hash } from 'bcryptjs';
import { fileTypeFromBuffer } from 'file-type';
import type {
  AccountRequestStatus,
  ApproveAccountRequestInput,
  ChangePasswordInput,
  CreateUserInput,
  RejectAccountRequestInput,
  ResetPasswordInput,
  Role,
  SubmitAccountRequestInput,
  UpdateUserInput,
} from '@dts/contracts';
import type { RequestUser } from '../../common/request-user.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { OutboxWriter } from '../audit/outbox.writer.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import { OrganizationService } from '../organization/organization.service.js';
import {
  UsersRepository,
  normalizeEmail,
  type UserPatch,
  type UserRow,
} from '../users/users.repository.js';
import {
  AccountRequestsRepository,
  type AccountRequestRow,
} from './account-requests.repository.js';
import { ProfilePhotosRepository } from './profile-photos.repository.js';

const BCRYPT_ROUNDS = 12;

export const MAX_PROFILE_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_PROFILE_PHOTO_MEDIA_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

/**
 * What a user looks like over the wire. Built by hand rather than by spreading the row so a
 * column added to `users` later cannot silently start being served — `password_hash` in
 * particular must never leave the process.
 */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  divisionId: string | null;
  sectionId: string | null;
  canAccessConfidential: boolean;
  active: boolean;
  locked: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Likewise for account requests: the applicant's chosen password hash stays server-side. */
export interface PublicAccountRequest {
  id: string;
  email: string;
  displayName: string;
  status: AccountRequestStatus;
  requestedDivisionId: string | null;
  requestedSectionId: string | null;
  justification: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  rejectionReason: string | null;
  createdUserId: string | null;
  createdAt: Date;
}

export const toPublicUser = (user: UserRow, now = new Date()): PublicUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  role: user.role,
  divisionId: user.divisionId,
  sectionId: user.sectionId,
  canAccessConfidential: user.canAccessConfidential,
  active: user.active,
  locked: user.lockedUntil !== null && user.lockedUntil > now,
  lastLoginAt: user.lastLoginAt,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const toPublicAccountRequest = (request: AccountRequestRow): PublicAccountRequest => ({
  id: request.id,
  email: request.email,
  displayName: request.displayName,
  status: request.status,
  requestedDivisionId: request.requestedDivisionId,
  requestedSectionId: request.requestedSectionId,
  justification: request.justification,
  reviewedById: request.reviewedById,
  reviewedAt: request.reviewedAt,
  rejectionReason: request.rejectionReason,
  createdUserId: request.createdUserId,
  createdAt: request.createdAt,
});

const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === UNIQUE_VIOLATION;

@Injectable()
export class IdentityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly users: UsersRepository,
    private readonly requests: AccountRequestsRepository,
    private readonly photos: ProfilePhotosRepository,
    private readonly organization: OrganizationService,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditWriter,
    private readonly outbox: OutboxWriter,
  ) {}

  // ---------------------------------------------------------------- account requests

  /**
   * Accepts a self-service application. Unauthenticated by design — this is how someone
   * without an account gets one.
   *
   * The caller is told the same thing whether or not the address is already taken: an
   * attacker must not be able to use the public request form as an account-existence oracle,
   * which would undo the effort login goes to in order to stay quiet (decision register 97).
   * The audit trail records what actually happened, so an administrator wondering why an
   * application never appeared can still find out.
   */
  async submitAccountRequest(
    input: SubmitAccountRequestInput,
    sourceIp?: string,
  ): Promise<{ submitted: true }> {
    const email = normalizeEmail(input.email);
    // Validate the requested placement first: a bad division ID is the applicant's own mistake
    // to fix, and saying so leaks nothing about who already has an account. `STAFF_MEMBER` is
    // passed as the role because the applicant does not choose one — this call is only being
    // used to check that the referenced rows exist, are active and belong together.
    if (input.requestedDivisionId !== undefined) {
      await this.organization.resolvePlacement({
        role: input.requestedSectionId === undefined ? 'DIVISION_HEAD' : 'STAFF_MEMBER',
        divisionId: input.requestedDivisionId,
        sectionId: input.requestedSectionId ?? null,
      });
    } else if (input.requestedSectionId !== undefined) {
      throw new BadRequestException('A section cannot be requested without its division');
    }

    const existingUser = await this.users.findByEmail(email);
    const existingRequest = await this.requests.findPendingByEmail(email);
    if (existingUser !== null || existingRequest !== null) {
      await this.audit.write({
        actorId: null,
        action: 'account-request.submitted',
        targetType: 'account-request',
        targetId: existingRequest?.id ?? existingUser?.id ?? 'duplicate',
        outcome: 'FAILURE',
        sourceIp: sourceIp ?? null,
        summary: { reason: existingUser === null ? 'REQUEST_ALREADY_PENDING' : 'ACCOUNT_EXISTS' },
      });
      return { submitted: true };
    }

    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
    try {
      await this.database.transaction(async (tx) => {
        const created = await this.requests.insert(
          {
            email,
            displayName: input.displayName,
            passwordHash,
            requestedDivisionId: input.requestedDivisionId ?? null,
            requestedSectionId: input.requestedSectionId ?? null,
            justification: input.justification ?? null,
          },
          tx,
        );
        await this.audit.write(
          {
            actorId: null,
            action: 'account-request.submitted',
            targetType: 'account-request',
            targetId: created.id,
            outcome: 'SUCCESS',
            sourceIp: sourceIp ?? null,
            summary: { requestedDivisionId: created.requestedDivisionId },
          },
          tx,
        );
        await this.outbox.enqueue(
          {
            aggregateType: 'account-request',
            aggregateId: created.id,
            eventType: 'account-request.submitted',
            payload: { requestId: created.id },
            idempotencyKey: `account-request.submitted:${created.id}`,
          },
          tx,
        );
      });
    } catch (error) {
      // The partial unique index is the real guard against two simultaneous applications;
      // losing that race is still a successful outcome from the applicant's point of view.
      if (!isUniqueViolation(error)) throw error;
    }
    return { submitted: true };
  }

  async listAccountRequests(
    actor: RequestUser,
    status?: AccountRequestStatus,
  ): Promise<PublicAccountRequest[]> {
    this.authorization.assert(actor, 'account-request:list');
    const rows = await this.requests.list(status);
    return rows.map(toPublicAccountRequest);
  }

  /**
   * Turns a pending application into a real account. One transaction covers the user row, the
   * request's closure, the audit row and the outbox event, so an approval can never leave a
   * user who exists against a request that still looks pending.
   */
  async approveAccountRequest(
    actor: RequestUser,
    id: string,
    input: ApproveAccountRequestInput,
  ): Promise<PublicUser> {
    this.authorization.assert(actor, 'account-request:approve');
    const request = await this.requests.findById(id);
    if (request === null) throw new NotFoundException('Account request not found');
    if (request.status !== 'PENDING')
      throw new ConflictException({
        code: 'REQUEST_ALREADY_REVIEWED',
        message: 'This account request has already been reviewed',
      });
    // The administrator's choice wins; the applicant's request is only a suggestion. Falling
    // back to it means a form that only sets the role still lands the user somewhere sane.
    const placement = await this.organization.resolvePlacement({
      role: input.role,
      divisionId: input.divisionId ?? request.requestedDivisionId,
      sectionId: input.sectionId ?? request.requestedSectionId,
    });
    if ((await this.users.findByEmail(request.email)) !== null)
      throw new ConflictException({
        code: 'EMAIL_ALREADY_REGISTERED',
        message: 'An account already exists for that email address',
      });

    return this.database.transaction(async (tx) => {
      const user = await this.users.insert(
        {
          email: request.email,
          displayName: request.displayName,
          // Carried over from the application: the applicant already chose a password and
          // never learns a temporary one, so there is nothing to communicate out of band.
          passwordHash: request.passwordHash,
          role: input.role,
          divisionId: placement.divisionId,
          sectionId: placement.sectionId,
          canAccessConfidential: input.canAccessConfidential,
        },
        tx,
      );
      const reviewed = await this.requests.review(
        id,
        { status: 'APPROVED', reviewedById: actor.id, createdUserId: user.id },
        tx,
      );
      if (reviewed === null)
        throw new ConflictException({
          code: 'REQUEST_ALREADY_REVIEWED',
          message: 'This account request has already been reviewed',
        });
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'account-request.approved',
          targetType: 'account-request',
          targetId: id,
          outcome: 'SUCCESS',
          summary: {
            userId: user.id,
            role: user.role,
            divisionId: user.divisionId,
            sectionId: user.sectionId,
          },
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'account-request',
          aggregateId: id,
          eventType: 'account-request.approved',
          payload: { requestId: id, userId: user.id },
          idempotencyKey: `account-request.approved:${id}`,
        },
        tx,
      );
      return toPublicUser(user);
    });
  }

  async rejectAccountRequest(
    actor: RequestUser,
    id: string,
    input: RejectAccountRequestInput,
  ): Promise<PublicAccountRequest> {
    this.authorization.assert(actor, 'account-request:reject');
    return this.database.transaction(async (tx) => {
      const reviewed = await this.requests.review(
        id,
        { status: 'REJECTED', reviewedById: actor.id, rejectionReason: input.reason },
        tx,
      );
      if (reviewed === null) {
        // Either the ID is wrong or somebody else got there first. Both are told apart for an
        // administrator, who is already trusted to see the queue.
        const existing = await this.requests.findById(id);
        if (existing === null) throw new NotFoundException('Account request not found');
        throw new ConflictException({
          code: 'REQUEST_ALREADY_REVIEWED',
          message: 'This account request has already been reviewed',
        });
      }
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'account-request.rejected',
          targetType: 'account-request',
          targetId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'account-request',
          aggregateId: id,
          eventType: 'account-request.rejected',
          payload: { requestId: id },
          idempotencyKey: `account-request.rejected:${id}`,
        },
        tx,
      );
      return toPublicAccountRequest(reviewed);
    });
  }

  // ------------------------------------------------------------------------- users

  async listUsers(
    actor: RequestUser,
    filters: {
      search?: string | undefined;
      role?: Role | undefined;
      divisionId?: string | undefined;
      active?: boolean | undefined;
    } = {},
  ): Promise<PublicUser[]> {
    this.authorization.assert(actor, 'user:list');
    const rows = await this.users.list(filters);
    return rows.map((row) => toPublicUser(row));
  }

  /**
   * The assignee picker's data source. Deliberately narrower than {@link listUsers}: it is
   * open to anyone who may route a document, so it returns only the fields the picker renders
   * and only the people the actor may already see, scoped the same way documents are.
   */
  async listAssignableUsers(
    actor: RequestUser,
  ): Promise<{ id: string; displayName: string; role: Role; divisionId: string | null }[]> {
    const rows = await this.users.list({ active: true });
    const visible = rows.filter((row) =>
      this.authorization.can(actor, 'user:read', {
        id: row.id,
        role: row.role,
        divisionId: row.divisionId,
        sectionId: row.sectionId,
      }),
    );
    return visible.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      role: row.role,
      divisionId: row.divisionId,
    }));
  }

  async getUser(actor: RequestUser, id: string): Promise<PublicUser> {
    const user = await this.users.findById(id);
    // Authorize against the loaded row, then report a miss and a refusal identically: a
    // guessed ID must not be distinguishable from one that exists but is out of reach.
    if (
      user === null ||
      !this.authorization.can(actor, 'user:read', {
        id: user.id,
        role: user.role,
        divisionId: user.divisionId,
        sectionId: user.sectionId,
      })
    )
      throw new NotFoundException('User not found');
    return toPublicUser(user);
  }

  async createUser(actor: RequestUser, input: CreateUserInput): Promise<PublicUser> {
    this.authorization.assert(actor, 'user:create');
    const placement = await this.organization.resolvePlacement({
      role: input.role,
      divisionId: input.divisionId,
      sectionId: input.sectionId,
    });
    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
    try {
      return await this.database.transaction(async (tx) => {
        const user = await this.users.insert(
          {
            email: input.email,
            displayName: input.displayName,
            passwordHash,
            role: input.role,
            divisionId: placement.divisionId,
            sectionId: placement.sectionId,
            canAccessConfidential: input.canAccessConfidential,
          },
          tx,
        );
        await this.audit.write(
          {
            actorId: actor.id,
            action: 'user.created',
            targetType: 'user',
            targetId: user.id,
            outcome: 'SUCCESS',
            summary: { role: user.role, divisionId: user.divisionId, sectionId: user.sectionId },
          },
          tx,
        );
        return toPublicUser(user);
      });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ConflictException({
          code: 'EMAIL_ALREADY_REGISTERED',
          message: 'An account already exists for that email address',
        });
      throw error;
    }
  }

  async updateUser(actor: RequestUser, id: string, input: UpdateUserInput): Promise<PublicUser> {
    const existing = await this.users.findById(id);
    if (existing === null) throw new NotFoundException('User not found');
    this.authorization.assert(actor, 'user:update', {
      id: existing.id,
      role: existing.role,
      divisionId: existing.divisionId,
      sectionId: existing.sectionId,
    });

    const role = input.role ?? existing.role;
    // Validate the placement the user will *end up* with. Patching only the role has to be
    // rejected when the division they already sit in cannot satisfy the new role's rules.
    const placement = await this.organization.resolvePlacement({
      role,
      divisionId: input.divisionId === undefined ? existing.divisionId : input.divisionId,
      sectionId: input.sectionId === undefined ? existing.sectionId : input.sectionId,
    });
    if (existing.role === 'ADMINISTRATOR' && role !== 'ADMINISTRATOR')
      await this.assertNotLastAdministrator(existing);

    const patch: UserPatch = {
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.canAccessConfidential === undefined
        ? {}
        : { canAccessConfidential: input.canAccessConfidential }),
      role,
      divisionId: placement.divisionId,
      sectionId: placement.sectionId,
    };

    return this.database.transaction(async (tx) => {
      const updated = await this.users.update(id, patch, tx);
      if (updated === null) throw new NotFoundException('User not found');
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'user.updated',
          targetType: 'user',
          targetId: id,
          outcome: 'SUCCESS',
          summary: {
            fields: Object.keys(patch),
            role: updated.role,
            divisionId: updated.divisionId,
            sectionId: updated.sectionId,
          },
        },
        tx,
      );
      return toPublicUser(updated);
    });
  }

  /**
   * Soft deactivation (decision register 3): the row stays so every document, assignment and
   * audit entry the person touched keeps a resolvable author. Their sessions die on their next
   * request because `AuthGuard` re-reads the row, and they cannot start a new one (decision
   * register 93). The session version is bumped too, so reactivating the account later does
   * not bring those sessions back (risk R-22).
   */
  async deactivateUser(actor: RequestUser, id: string): Promise<PublicUser> {
    const existing = await this.users.findById(id);
    if (existing === null) throw new NotFoundException('User not found');
    this.authorization.assert(actor, 'user:deactivate', {
      id: existing.id,
      role: existing.role,
      divisionId: existing.divisionId,
      sectionId: existing.sectionId,
    });
    if (!existing.active) return toPublicUser(existing);
    if (existing.role === 'ADMINISTRATOR') await this.assertNotLastAdministrator(existing);

    return this.database.transaction(async (tx) => {
      const updated = await this.users.update(id, { active: false }, tx, { endSessions: true });
      if (updated === null) throw new NotFoundException('User not found');
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'user.deactivated',
          targetType: 'user',
          targetId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      await this.outbox.enqueue(
        {
          aggregateType: 'user',
          aggregateId: id,
          eventType: 'user.deactivated',
          payload: { userId: id },
          idempotencyKey: `user.deactivated:${id}:${updated.updatedAt.toISOString()}`,
        },
        tx,
      );
      return toPublicUser(updated);
    });
  }

  async reactivateUser(actor: RequestUser, id: string): Promise<PublicUser> {
    const existing = await this.users.findById(id);
    if (existing === null) throw new NotFoundException('User not found');
    this.authorization.assert(actor, 'user:reactivate', {
      id: existing.id,
      role: existing.role,
      divisionId: existing.divisionId,
      sectionId: existing.sectionId,
    });
    return this.database.transaction(async (tx) => {
      // Reactivation also clears the lockout counters: an administrator turning an account
      // back on expects the person to be able to sign in, not to hit a stale lock. It bumps the
      // session version as well. Deactivation already did, but an account deactivated before
      // migration 0014 was not bumped, and its old sessions must not come back either (R-22).
      const updated = await this.users.update(
        id,
        { active: true, failedLoginAttempts: 0, lockedUntil: null },
        tx,
        { endSessions: true },
      );
      if (updated === null) throw new NotFoundException('User not found');
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'user.reactivated',
          targetType: 'user',
          targetId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
      return toPublicUser(updated);
    });
  }

  // ----------------------------------------------------------------- passwords

  /**
   * The signed-in user changes their own password (risk R-22). Every session they hold ends,
   * this one included. The controller issues a fresh one under the returned version, so the
   * caller stays signed in. A wrong current password is audited as a failure and changes nothing.
   */
  async changeOwnPassword(
    actor: RequestUser,
    input: ChangePasswordInput,
    sourceIp?: string,
  ): Promise<{ sessionVersion: number }> {
    const existing = await this.users.findById(actor.id);
    if (existing === null) throw new NotFoundException('User not found');
    if (!(await compare(input.currentPassword, existing.passwordHash))) {
      await this.audit.write({
        actorId: actor.id,
        action: 'user.password-changed',
        targetType: 'user',
        targetId: actor.id,
        outcome: 'FAILURE',
        sourceIp: sourceIp ?? null,
        summary: { reason: 'CURRENT_PASSWORD_INCORRECT' },
      });
      // Shaped like a validation failure, so a form puts the message on the field that caused it.
      throw new BadRequestException({
        code: 'CURRENT_PASSWORD_INCORRECT',
        message: 'The current password is incorrect',
        details: {
          formErrors: [],
          fieldErrors: { currentPassword: ['The current password is incorrect'] },
        },
      });
    }
    const passwordHash = await hash(input.newPassword, BCRYPT_ROUNDS);
    return this.database.transaction(async (tx) => {
      const updated = await this.users.setPassword(actor.id, passwordHash, tx);
      if (updated === null) throw new NotFoundException('User not found');
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'user.password-changed',
          targetType: 'user',
          targetId: actor.id,
          outcome: 'SUCCESS',
          sourceIp: sourceIp ?? null,
        },
        tx,
      );
      return { sessionVersion: updated.sessionVersion };
    });
  }

  /**
   * An administrator sets a new password for someone who has forgotten theirs, or whose account
   * may be compromised (risk R-22). Ends every session the user holds and clears any lockout.
   * Never for the actor's own account, because this path skips the current-password check.
   */
  async resetPassword(actor: RequestUser, id: string, input: ResetPasswordInput): Promise<void> {
    const existing = await this.users.findById(id);
    if (existing === null) throw new NotFoundException('User not found');
    this.authorization.assert(actor, 'user:reset-password', {
      id: existing.id,
      role: existing.role,
      divisionId: existing.divisionId,
      sectionId: existing.sectionId,
    });
    const passwordHash = await hash(input.password, BCRYPT_ROUNDS);
    await this.database.transaction(async (tx) => {
      const updated = await this.users.setPassword(id, passwordHash, tx);
      if (updated === null) throw new NotFoundException('User not found');
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'user.password-reset',
          targetType: 'user',
          targetId: id,
          outcome: 'SUCCESS',
        },
        tx,
      );
    });
  }

  // ----------------------------------------------------------------- profile photos

  async setProfilePhoto(
    actor: RequestUser,
    file: { buffer: Buffer; originalName: string },
  ): Promise<{ mediaType: string; sizeBytes: number }> {
    if (file.buffer.byteLength === 0)
      throw new BadRequestException({ code: 'EMPTY_FILE', message: 'Uploaded file is empty' });
    if (file.buffer.byteLength > MAX_PROFILE_PHOTO_BYTES)
      throw new PayloadTooLargeException({
        code: 'FILE_TOO_LARGE',
        message: `Profile photo exceeds the ${MAX_PROFILE_PHOTO_BYTES}-byte limit`,
      });
    // Same rule as document attachments: trust the bytes, not the declared Content-Type, so
    // a script renamed to `.png` cannot be stored and later served back as an image.
    const detected = await fileTypeFromBuffer(file.buffer);
    if (detected === undefined || !ALLOWED_PROFILE_PHOTO_MEDIA_TYPES.has(detected.mime))
      throw new UnsupportedMediaTypeException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Profile photos must be PNG, JPEG or WebP',
      });

    const checksumSha256 = createHash('sha256').update(file.buffer).digest('hex');
    await this.database.transaction(async (tx) => {
      await this.photos.upsert(
        {
          userId: actor.id,
          mediaType: detected.mime,
          sizeBytes: file.buffer.byteLength,
          checksumSha256,
          content: file.buffer,
        },
        tx,
      );
      await this.audit.write(
        {
          actorId: actor.id,
          action: 'user.photo-updated',
          targetType: 'user',
          targetId: actor.id,
          outcome: 'SUCCESS',
          summary: { mediaType: detected.mime, sizeBytes: file.buffer.byteLength },
        },
        tx,
      );
    });
    return { mediaType: detected.mime, sizeBytes: file.buffer.byteLength };
  }

  async getProfilePhoto(
    actor: RequestUser,
    userId: string,
  ): Promise<{ mediaType: string; content: Buffer; checksumSha256: string }> {
    const owner = await this.users.findById(userId);
    if (
      owner === null ||
      !this.authorization.can(actor, 'user:read', {
        id: owner.id,
        role: owner.role,
        divisionId: owner.divisionId,
        sectionId: owner.sectionId,
      })
    )
      throw new NotFoundException('Profile photo not found');
    const photo = await this.photos.find(userId);
    if (photo === null) throw new NotFoundException('Profile photo not found');
    return {
      mediaType: photo.mediaType,
      content: photo.content,
      checksumSha256: photo.checksumSha256,
    };
  }

  async hasProfilePhoto(userId: string): Promise<boolean> {
    return this.photos.exists(userId);
  }

  /**
   * Refuses the change that would leave nobody able to administer the system. Checked before
   * the transaction and again implicitly by the count inside it; the window between them is
   * only reachable by two administrators demoting each other simultaneously, which leaves the
   * system recoverable by the seed rather than permanently locked.
   */
  private async assertNotLastAdministrator(user: UserRow): Promise<void> {
    const remaining = await this.users.countActiveWithRole('ADMINISTRATOR');
    if (remaining <= 1 && user.active)
      throw new ConflictException({
        code: 'LAST_ADMINISTRATOR',
        message: 'The last active administrator cannot be removed',
      });
  }
}
