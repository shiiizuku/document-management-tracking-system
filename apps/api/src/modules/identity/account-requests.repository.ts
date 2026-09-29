import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { AccountRequestStatus } from '@dts/contracts';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { accountRequests } from '../../database/schema.js';
import { normalizeEmail } from '../users/users.repository.js';

export type AccountRequestRow = typeof accountRequests.$inferSelect;

export interface NewAccountRequest {
  email: string;
  displayName: string;
  passwordHash: string;
  requestedDivisionId: string | null;
  requestedSectionId: string | null;
  justification: string | null;
}

export interface ReviewOutcome {
  status: Exclude<AccountRequestStatus, 'PENDING'>;
  reviewedById: string;
  rejectionReason?: string | null;
  createdUserId?: string | null;
}

@Injectable()
export class AccountRequestsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async insert(
    values: NewAccountRequest,
    executor: DatabaseExecutor = this.database,
  ): Promise<AccountRequestRow> {
    const [row] = await executor
      .insert(accountRequests)
      .values({ ...values, email: normalizeEmail(values.email) })
      .returning();
    if (!row) throw new Error('Insert of an account request returned no row');
    return row;
  }

  async findById(id: string): Promise<AccountRequestRow | null> {
    const [row] = await this.database
      .select()
      .from(accountRequests)
      .where(eq(accountRequests.id, id));
    return row ?? null;
  }

  async list(status?: AccountRequestStatus): Promise<AccountRequestRow[]> {
    return this.database
      .select()
      .from(accountRequests)
      .where(status === undefined ? undefined : eq(accountRequests.status, status))
      .orderBy(desc(accountRequests.createdAt));
  }

  /**
   * Closes a pending request. The `status = 'PENDING'` predicate is the concurrency control:
   * two administrators clicking approve and reject at the same moment produce one winner and
   * one `null` here, which the service turns into a 409 instead of both appearing to succeed.
   */
  async review(
    id: string,
    outcome: ReviewOutcome,
    executor: DatabaseExecutor = this.database,
  ): Promise<AccountRequestRow | null> {
    const [row] = await executor
      .update(accountRequests)
      .set({
        status: outcome.status,
        reviewedById: outcome.reviewedById,
        reviewedAt: new Date(),
        rejectionReason: outcome.rejectionReason ?? null,
        createdUserId: outcome.createdUserId ?? null,
      })
      .where(and(eq(accountRequests.id, id), eq(accountRequests.status, 'PENDING')))
      .returning();
    return row ?? null;
  }

  async findPendingByEmail(email: string): Promise<AccountRequestRow | null> {
    const [row] = await this.database
      .select()
      .from(accountRequests)
      .where(
        and(
          sql`lower(${accountRequests.email}) = ${normalizeEmail(email)}`,
          eq(accountRequests.status, 'PENDING'),
        ),
      );
    return row ?? null;
  }
}
