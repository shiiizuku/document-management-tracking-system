import { hashSync } from 'bcryptjs';
import type { UserFilters, UserRow } from '../src/modules/users/users.repository.js';

const timestamp = new Date('2026-09-28T00:00:00.000Z');

const seedUser = (overrides: Partial<UserRow> & Pick<UserRow, 'id' | 'email'>): UserRow => ({
  displayName: 'Seed User',
  passwordHash: hashSync('Records@1234!', 4),
  role: 'RECORDS_STAFF',
  divisionId: 'division-records',
  sectionId: 'section-intake',
  canAccessConfidential: true,
  active: true,
  failedLoginAttempts: 0,
  lockedUntil: null,
  passwordChangedAt: timestamp,
  lastLoginAt: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

const seedUsers = (): UserRow[] => [
  seedUser({
    id: '00000000-0000-4000-8000-000000000001',
    email: 'records@dts.local',
    displayName: 'Records Officer',
    passwordHash: hashSync('Records@1234!', 4),
    role: 'RECORDS_STAFF',
    divisionId: 'division-records',
    sectionId: 'section-intake',
    canAccessConfidential: true,
  }),
  seedUser({
    id: '00000000-0000-4000-8000-000000000002',
    email: 'staff@dts.local',
    displayName: 'Pilot Staff',
    passwordHash: hashSync('Staff@12345!', 4),
    role: 'STAFF_MEMBER',
    divisionId: 'division-pilot',
    sectionId: 'section-pilot',
    canAccessConfidential: false,
  }),
  // The only seeded holder of DOCUMENT_DELETE / DOCUMENT_RESTORE and the admin capabilities, so
  // the REST suites can exercise the administrator-only routes rather than only their refusals.
  seedUser({
    id: '00000000-0000-4000-8000-000000000004',
    email: 'admin@dts.local',
    displayName: 'System Administrator',
    passwordHash: hashSync('Admin@12345!', 4),
    role: 'ADMINISTRATOR',
    divisionId: 'division-records',
    sectionId: null,
    canAccessConfidential: true,
  }),
  // The only seeded holder of DOCUMENT_SIGN that is not the break-glass administrator
  // (ADR-0006), so the REST suites sign as the authority that actually holds the capability.
  // Placed in the records division rather than a separate ORD because these suites run against
  // in-memory repositories with no organization tree — what matters is that the role is right.
  seedUser({
    id: '00000000-0000-4000-8000-000000000005',
    email: 'director@dts.local',
    displayName: 'Regional Director',
    passwordHash: hashSync('Director@1234!', 4),
    role: 'DIRECTOR',
    divisionId: 'division-records',
    sectionId: null,
    canAccessConfidential: true,
  }),
  seedUser({
    id: '00000000-0000-4000-8000-000000000003',
    email: 'viewer@dts.local',
    displayName: 'Pilot Viewer',
    passwordHash: hashSync('Viewer@1234!', 4),
    role: 'VIEWER',
    divisionId: 'division-pilot',
    sectionId: 'section-pilot',
    canAccessConfidential: false,
  }),
];

/**
 * Stand-in for {@link UsersRepository} in the full-app REST suites, which run without a
 * database. It implements only the read and login-bookkeeping methods the authentication
 * flow exercises; the mutating admin methods are not reached by those tests.
 *
 * Each instance owns a fresh copy of the seed rows so that login bookkeeping (failed-attempt
 * counters, lockout) mutated by one test cannot leak into the next through shared state — the
 * DI container builds one instance per test application.
 */
export class InMemoryUsersRepository {
  private readonly persistedUsers = seedUsers();

  findByEmail(email: string): Promise<UserRow | null> {
    return Promise.resolve(
      this.persistedUsers.find((user) => user.email === email.trim().toLowerCase()) ?? null,
    );
  }

  findById(id: string): Promise<UserRow | null> {
    return Promise.resolve(this.persistedUsers.find((user) => user.id === id) ?? null);
  }

  /**
   * Only the filters the forwarding path uses: role, division and active. Enough for
   * `divisionHeadsOf` to resolve who a for-information copy notifies, which is the one place the
   * REST suites reach this method.
   */
  list(filters: UserFilters = {}): Promise<UserRow[]> {
    return Promise.resolve(
      this.persistedUsers.filter(
        (user) =>
          (filters.role === undefined || user.role === filters.role) &&
          (filters.divisionId === undefined || user.divisionId === filters.divisionId) &&
          (filters.active === undefined || user.active === filters.active),
      ),
    );
  }

  registerFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutMs: number,
  ): Promise<{ lockedUntil: Date | null }> {
    const user = this.persistedUsers.find((candidate) => candidate.id === id);
    if (!user) return Promise.resolve({ lockedUntil: null });
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= maxAttempts && user.lockedUntil === null) {
      user.lockedUntil = new Date(Date.now() + lockoutMs);
    }
    return Promise.resolve({ lockedUntil: user.lockedUntil });
  }

  recordSuccessfulLogin(id: string): Promise<void> {
    const user = this.persistedUsers.find((candidate) => candidate.id === id);
    if (user) {
      user.failedLoginAttempts = 0;
      user.lockedUntil = null;
      user.lastLoginAt = new Date();
    }
    return Promise.resolve();
  }
}
