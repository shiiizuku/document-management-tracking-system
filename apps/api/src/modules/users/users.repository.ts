import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Role } from '@dts/contracts';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { users } from '../../database/schema.js';

export type UserRow = typeof users.$inferSelect;

export interface UserFilters {
  search?: string | undefined;
  role?: Role | undefined;
  divisionId?: string | undefined;
  active?: boolean | undefined;
}

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
  role: Role;
  divisionId: string | null;
  sectionId: string | null;
  canAccessConfidential: boolean;
}

export interface UserPatch {
  displayName?: string;
  role?: Role;
  divisionId?: string | null;
  sectionId?: string | null;
  canAccessConfidential?: boolean;
  active?: boolean;
  // Only ever written as a pair, and only to clear a lock — the increment path is
  // `registerFailedLogin`, which has to do its arithmetic in SQL.
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
}

/** Addresses are compared and stored lowercased so `A@x` and `a@x` can never be two accounts. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const user = await this.database.query.users.findFirst({
      where: eq(users.email, normalizeEmail(email)),
    });
    return user ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const user = await this.database.query.users.findFirst({ where: eq(users.id, id) });
    return user ?? null;
  }

  async list(filters: UserFilters = {}): Promise<UserRow[]> {
    const conditions: SQL[] = [];
    if (filters.search) {
      const pattern = `%${filters.search}%`;
      const matchesText = or(ilike(users.displayName, pattern), ilike(users.email, pattern));
      if (matchesText) conditions.push(matchesText);
    }
    if (filters.role) conditions.push(eq(users.role, filters.role));
    if (filters.divisionId) conditions.push(eq(users.divisionId, filters.divisionId));
    if (filters.active !== undefined) conditions.push(eq(users.active, filters.active));
    return this.database
      .select()
      .from(users)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(asc(users.displayName));
  }

  async insert(values: NewUser, executor: DatabaseExecutor = this.database): Promise<UserRow> {
    const [user] = await executor
      .insert(users)
      .values({ ...values, email: normalizeEmail(values.email), passwordChangedAt: new Date() })
      .returning();
    if (!user) throw new Error('Insert of a user returned no row');
    return user;
  }

  async update(
    id: string,
    patch: UserPatch,
    executor: DatabaseExecutor = this.database,
  ): Promise<UserRow | null> {
    const [user] = await executor.update(users).set(patch).where(eq(users.id, id)).returning();
    return user ?? null;
  }

  /** Active accounts holding a role, used to refuse removing the last administrator. */
  async countActiveWithRole(role: Role): Promise<number> {
    const [row] = await this.database
      .select({ total: count() })
      .from(users)
      .where(and(eq(users.role, role), eq(users.active, true)));
    return row?.total ?? 0;
  }

  /**
   * Records a failed sign-in and locks the account once the threshold is reached.
   *
   * The increment and the comparison happen in one statement so a burst of parallel guesses
   * cannot each read `attempts = 4` and all conclude they are under the limit. `attempts` is
   * left as-is once the lock is set, so the window does not keep sliding forward while an
   * attacker hammers a locked account.
   */
  async registerFailedLogin(
    id: string,
    maxAttempts: number,
    lockoutMs: number,
  ): Promise<{ lockedUntil: Date | null }> {
    const [row] = await this.database
      .update(users)
      .set({
        failedLoginAttempts: sql`${users.failedLoginAttempts} + 1`,
        lockedUntil: sql`case when ${users.failedLoginAttempts} + 1 >= ${maxAttempts}
                              then now() + (${lockoutMs} * interval '1 millisecond')
                              else ${users.lockedUntil} end`,
      })
      .where(eq(users.id, id))
      .returning({ lockedUntil: users.lockedUntil });
    return { lockedUntil: row?.lockedUntil ?? null };
  }

  /** Clears the lockout counters and stamps the sign-in. Called only after a success. */
  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.database
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(users.id, id));
  }
}
