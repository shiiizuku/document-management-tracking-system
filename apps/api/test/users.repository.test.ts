import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/database/client.js';
import type { UserRow } from '../src/modules/users/users.repository.js';
import { UsersRepository } from '../src/modules/users/users.repository.js';

const persistedUser: UserRow = {
  id: '2f4e8aa8-2534-4f9d-98a4-ef2fc67f3904',
  email: 'records@dts.local',
  displayName: 'Records Officer',
  passwordHash: '$2b$12$hash',
  role: 'RECORDS_STAFF',
  divisionId: '65d8c120-cb25-455d-badc-fbb8ca114b93',
  sectionId: '41da46cb-4fa5-48c9-9697-4126ebf84970',
  canAccessConfidential: true,
  active: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  sessionVersion: 0,
  passwordChangedAt: new Date('2026-09-28T00:00:00.000Z'),
  lastLoginAt: null,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
};

const repositoryWithResult = (result: UserRow | undefined) => {
  const findFirst = vi.fn().mockResolvedValue(result);
  const database = { query: { users: { findFirst } } } as unknown as Database;
  return { repository: new UsersRepository(database), findFirst };
};

describe('UsersRepository', () => {
  it('returns a typed persisted user by normalized email', async () => {
    const { repository, findFirst } = repositoryWithResult(persistedUser);

    await expect(repository.findByEmail('  RECORDS@DTS.LOCAL ')).resolves.toEqual(persistedUser);
    expect(findFirst).toHaveBeenCalledOnce();
  });

  it('returns null when an id is not present', async () => {
    const { repository } = repositoryWithResult(undefined);

    await expect(repository.findById('missing-user')).resolves.toBeNull();
  });
});
