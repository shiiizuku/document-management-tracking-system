import { hashSync } from 'bcryptjs';
import type { UserRow } from '../src/modules/users/users.repository.js';

const timestamp = new Date('2026-09-28T00:00:00.000Z');
const persistedUsers: UserRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    email: 'records@dts.local',
    displayName: 'Records Officer',
    passwordHash: hashSync('Records@1234!', 4),
    role: 'RECORDS_STAFF',
    divisionId: 'division-records',
    sectionId: 'section-intake',
    canAccessConfidential: true,
    active: true,
    profilePhotoObjectKey: null,
    lastLoginAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    email: 'staff@dts.local',
    displayName: 'Pilot Staff',
    passwordHash: hashSync('Staff@12345!', 4),
    role: 'STAFF_MEMBER',
    divisionId: 'division-pilot',
    sectionId: 'section-pilot',
    canAccessConfidential: false,
    active: true,
    profilePhotoObjectKey: null,
    lastLoginAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    email: 'viewer@dts.local',
    displayName: 'Pilot Viewer',
    passwordHash: hashSync('Viewer@1234!', 4),
    role: 'VIEWER',
    divisionId: 'division-pilot',
    sectionId: 'section-pilot',
    canAccessConfidential: false,
    active: true,
    profilePhotoObjectKey: null,
    lastLoginAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];

export class InMemoryUsersRepository {
  findByEmail(email: string): Promise<UserRow | null> {
    return Promise.resolve(
      persistedUsers.find((user) => user.email === email.trim().toLowerCase()) ?? null,
    );
  }

  findById(id: string): Promise<UserRow | null> {
    return Promise.resolve(persistedUsers.find((user) => user.id === id) ?? null);
  }
}
