import { hash } from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { pseudonymizeEmail, type AuditWriter } from '../src/modules/audit/audit.writer.js';
import type { UserRow, UsersRepository } from '../src/modules/users/users.repository.js';

const userRow = async (overrides: Partial<UserRow> = {}): Promise<UserRow> => ({
  id: '2f4e8aa8-2534-4f9d-98a4-ef2fc67f3904',
  email: 'records@dts.local',
  displayName: 'Records Officer',
  passwordHash: await hash('Records@1234!', 4),
  role: 'RECORDS_STAFF',
  divisionId: '65d8c120-cb25-455d-badc-fbb8ca114b93',
  sectionId: '41da46cb-4fa5-48c9-9697-4126ebf84970',
  canAccessConfidential: true,
  active: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  passwordChangedAt: new Date('2026-09-28T00:00:00.000Z'),
  lastLoginAt: null,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

const configWith = (values: Record<string, number>): ConfigService =>
  ({ getOrThrow: (key: string) => values[key] }) as unknown as ConfigService;

const serviceWith = (row: UserRow | null) => {
  const findByEmail = vi.fn().mockResolvedValue(row);
  const findById = vi.fn().mockResolvedValue(row);
  const registerFailedLogin = vi.fn().mockResolvedValue({ lockedUntil: null });
  const recordSuccessfulLogin = vi.fn().mockResolvedValue(undefined);
  const repository = {
    findByEmail,
    findById,
    registerFailedLogin,
    recordSuccessfulLogin,
  } as unknown as UsersRepository;
  const write = vi.fn().mockResolvedValue(undefined);
  const audit = { write, list: vi.fn() } as unknown as AuditWriter;
  const config = configWith({ LOGIN_MAX_ATTEMPTS: 5, LOGIN_LOCKOUT_MS: 900_000 });
  return {
    service: new AuthService(repository, audit, config),
    findByEmail,
    registerFailedLogin,
    recordSuccessfulLogin,
    write,
  };
};

describe('AuthService', () => {
  it('authenticates an active persisted user and derives role capabilities', async () => {
    const row = await userRow();
    const { service, findByEmail } = serviceWith(row);

    const authenticated = await service.authenticate(' RECORDS@DTS.LOCAL ', 'Records@1234!');
    expect(authenticated).toMatchObject({
      id: row.id,
      email: row.email,
      role: 'RECORDS_STAFF',
    });
    expect(authenticated.capabilities).toContain('DOCUMENT_CREATE');
    expect(authenticated.capabilities).toContain('DOCUMENT_ASSIGN');
    expect(findByEmail).toHaveBeenCalledWith(' RECORDS@DTS.LOCAL ');
  });

  it('rejects invalid credentials without revealing whether the user exists', async () => {
    const { service } = serviceWith(await userRow());

    await expect(service.authenticate('records@dts.local', 'wrong-password')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
  });

  it('uses the same generic credential error when the account does not exist', async () => {
    const { service } = serviceWith(null);

    await expect(service.authenticate('missing@dts.local', 'wrong-password')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
  });

  it('rejects inactive users during session lookup', async () => {
    const { service } = serviceWith(await userRow({ active: false }));

    await expect(service.getUser('2f4e8aa8-2534-4f9d-98a4-ef2fc67f3904')).rejects.toThrow(
      'Account is inactive',
    );
  });

  it('refuses a locked account even when the password is correct', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    const { service, recordSuccessfulLogin } = serviceWith(await userRow({ lockedUntil }));

    await expect(service.authenticate('records@dts.local', 'Records@1234!')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
    // A lock that a correct password could open would not be a lock at all.
    expect(recordSuccessfulLogin).not.toHaveBeenCalled();
  });

  it('never writes the address or password to the audit trail on a failed login', async () => {
    const { service, write } = serviceWith(null);

    await expect(
      service.authenticate('Nobody@DTS.local', 'Sup3r-Secret-Password!'),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));

    expect(write).toHaveBeenCalledOnce();
    const [entry] = write.mock.calls[0] as [{ outcome: string; summary?: Record<string, unknown> }];
    expect(entry.outcome).toBe('FAILURE');
    // The address is correlatable only through its truncated digest, never in the clear.
    expect(entry.summary?.emailHash).toBe(pseudonymizeEmail('Nobody@DTS.local'));
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('Nobody@DTS.local');
    expect(serialized).not.toContain('Sup3r-Secret-Password!');
  });
});
