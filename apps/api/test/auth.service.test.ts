import { hash } from 'bcryptjs';
import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/modules/auth/auth.service.js';
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
  profilePhotoObjectKey: null,
  lastLoginAt: null,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

const serviceWith = (row: UserRow | null) => {
  const findByEmail = vi.fn().mockResolvedValue(row);
  const findById = vi.fn().mockResolvedValue(row);
  const repository = {
    findByEmail,
    findById,
  } as unknown as UsersRepository;
  return { service: new AuthService(repository), findByEmail };
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
});
