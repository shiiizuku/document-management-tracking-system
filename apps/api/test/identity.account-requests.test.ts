import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../src/common/request-user.js';
import { AuthorizationService } from '../src/modules/authorization/authorization.service.js';
import { capabilitiesByRole } from '../src/modules/authorization/role-capabilities.js';
import { IdentityService } from '../src/modules/identity/identity.service.js';
import type { AccountRequestRow } from '../src/modules/identity/account-requests.repository.js';
import type { UserRow } from '../src/modules/users/users.repository.js';

const admin = (overrides: Partial<RequestUser> = {}): RequestUser => ({
  id: 'admin-1',
  email: 'admin@dts.local',
  displayName: 'Admin',
  role: 'ADMINISTRATOR',
  divisionId: null,
  sectionId: null,
  capabilities: [...capabilitiesByRole.ADMINISTRATOR],
  canAccessConfidential: true,
  active: true,
  ...overrides,
});

const requestRow = (overrides: Partial<AccountRequestRow> = {}): AccountRequestRow => ({
  id: 'request-1',
  email: 'applicant@dts.local',
  displayName: 'Applicant',
  passwordHash: '$2b$12$applicanthash',
  status: 'PENDING',
  requestedDivisionId: 'division-a',
  requestedSectionId: 'section-a1',
  justification: null,
  reviewedById: null,
  reviewedAt: null,
  rejectionReason: null,
  createdUserId: null,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

const userRow = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'user-1',
  email: 'applicant@dts.local',
  displayName: 'Applicant',
  passwordHash: '$2b$12$applicanthash',
  role: 'STAFF_MEMBER',
  divisionId: 'division-a',
  sectionId: 'section-a1',
  canAccessConfidential: false,
  active: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  sessionVersion: 0,
  passwordChangedAt: new Date('2026-09-28T00:00:00.000Z'),
  lastLoginAt: null,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

interface Doubles {
  users?: Record<string, ReturnType<typeof vi.fn>>;
  requests?: Record<string, ReturnType<typeof vi.fn>>;
  organization?: Record<string, ReturnType<typeof vi.fn>>;
}

const build = (doubles: Doubles = {}) => {
  const write = vi.fn().mockResolvedValue(undefined);
  const enqueue = vi.fn().mockResolvedValue(undefined);
  const database = {
    transaction: <T>(cb: (tx: string) => Promise<T>) => cb('tx'),
  };
  const users = { findByEmail: vi.fn(), insert: vi.fn(), ...doubles.users };
  const requests = {
    findPendingByEmail: vi.fn(),
    findById: vi.fn(),
    insert: vi.fn(),
    review: vi.fn(),
    ...doubles.requests,
  };
  const organization = {
    resolvePlacement: vi
      .fn()
      .mockResolvedValue({ divisionId: 'division-a', sectionId: 'section-a1' }),
    ...doubles.organization,
  };
  const service = new IdentityService(
    database as never,
    users as never,
    requests as never,
    {} as never,
    organization as never,
    new AuthorizationService(),
    { write, list: vi.fn() },
    { enqueue },
  );
  return { service, users, requests, organization, write, enqueue };
};

describe('IdentityService account requests', () => {
  it('does not reveal that an address is already taken, and does not insert a duplicate', async () => {
    const { service, requests, write } = build({
      users: { findByEmail: vi.fn().mockResolvedValue(userRow()) },
      requests: { findPendingByEmail: vi.fn().mockResolvedValue(null), insert: vi.fn() },
      organization: {
        resolvePlacement: vi.fn().mockResolvedValue({ divisionId: null, sectionId: null }),
      },
    });

    await expect(
      service.submitAccountRequest({
        email: 'applicant@dts.local',
        displayName: 'Applicant',
        password: 'Applicant@1234!',
      }),
    ).resolves.toEqual({ submitted: true });
    // The applicant is told the same "submitted" either way; no row is written and the audit
    // trail records the real reason for an administrator.
    expect(requests.insert).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'FAILURE', summary: { reason: 'ACCOUNT_EXISTS' } }),
    );
  });

  it('refuses approval by a caller without the review capability', async () => {
    const { service } = build();
    const viewer = admin({ role: 'VIEWER', capabilities: [...capabilitiesByRole.VIEWER] });

    await expect(
      service.approveAccountRequest(viewer, 'request-1', {
        role: 'STAFF_MEMBER',
        canAccessConfidential: false,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses to approve a request that has already been reviewed', async () => {
    const { service } = build({
      users: { findByEmail: vi.fn().mockResolvedValue(null) },
      requests: { findById: vi.fn().mockResolvedValue(requestRow({ status: 'REJECTED' })) },
    });

    // The specific code matters: skipping the status check would still fail, but on a
    // different rule, so a bare ConflictException assertion would not catch its loss.
    await expect(
      service.approveAccountRequest(admin(), 'request-1', {
        role: 'STAFF_MEMBER',
        canAccessConfidential: false,
      }),
    ).rejects.toMatchObject({ response: { code: 'REQUEST_ALREADY_REVIEWED' } });
  });

  it('creates the account, closes the request, and returns a user without its password hash', async () => {
    const created = userRow();
    const { service, requests, write, enqueue } = build({
      users: {
        findByEmail: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue(created),
      },
      requests: {
        findById: vi.fn().mockResolvedValue(requestRow()),
        review: vi.fn().mockResolvedValue(requestRow({ status: 'APPROVED' })),
      },
    });

    const result = await service.approveAccountRequest(admin(), 'request-1', {
      role: 'STAFF_MEMBER',
      canAccessConfidential: false,
    });

    expect(result).toMatchObject({ id: 'user-1', role: 'STAFF_MEMBER' });
    expect(result).not.toHaveProperty('passwordHash');
    // The whole approval — user, request closure, audit, outbox — rides one transaction.
    expect(requests.review).toHaveBeenCalledWith(
      'request-1',
      expect.objectContaining({ status: 'APPROVED', createdUserId: 'user-1' }),
      'tx',
    );
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'account-request.approved' }),
      'tx',
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'account-request.approved' }),
      'tx',
    );
  });

  it('reports a missing request as not found when rejecting', async () => {
    const { service } = build({
      requests: {
        review: vi.fn().mockResolvedValue(null),
        findById: vi.fn().mockResolvedValue(null),
      },
    });

    await expect(
      service.rejectAccountRequest(admin(), 'ghost', { reason: 'No such request' }),
    ).rejects.toThrow(NotFoundException);
  });
});
