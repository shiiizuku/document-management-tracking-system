import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, and, gte, lt, type SQL } from 'drizzle-orm';
import { getCorrelationId } from '../../common/request-context.js';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { auditEvents } from '../../database/schema.js';

export type AuditOutcome = 'SUCCESS' | 'FAILURE';

export interface AuditEntry {
  /** `null` only when the action had no authenticated actor — a failed or anonymous login. */
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  sourceIp?: string | null;
  /**
   * Structured detail for investigators. IDs, roles and enum values only: never passwords,
   * tokens, file contents, email addresses or display names (policy register P-14, decision
   * register 98). Use {@link pseudonymizeEmail} when an address has to be correlated.
   */
  summary?: Record<string, unknown>;
}

export type AuditEventRow = typeof auditEvents.$inferSelect;

export interface AuditQuery {
  actorId?: string;
  action?: string;
  /** Inclusive lower bound on `occurredAt`. Rows at or after this instant match. */
  from?: Date;
  /** Exclusive upper bound on `occurredAt`. Rows strictly before this instant match. */
  to?: Date;
  limit?: number;
  /** Row offset for pagination; paired with a deterministic `occurredAt DESC` order. */
  offset?: number;
}

/**
 * One window onto the trail, plus how many rows the filters match in total.
 *
 * The total is what makes the viewer honest. Without it a reader cannot tell "this is everything
 * that happened" from "this is the first hundred things", and an audit trail that silently
 * truncates is worse than one that refuses to answer. It also costs the same shape as the document
 * registry's page, so both lists drive the same table.
 */
export interface AuditEventPage {
  items: AuditEventRow[];
  total: number;
  /** The limit actually applied, which is not necessarily the one asked for — it is clamped. */
  limit: number;
  offset: number;
}

/**
 * Lets a failed login be correlated with other attempts on the same address without storing
 * the address. Truncated because the audit trail only needs "same target as before", and a
 * short digest is materially harder to reverse by dictionary attack than a full one.
 */
export const pseudonymizeEmail = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);

/**
 * Abstract so it doubles as the DI token: unit suites swap in an in-memory writer, while the
 * running app and the integration suites use {@link DrizzleAuditWriter}.
 */
@Injectable()
export abstract class AuditWriter {
  /**
   * Records one entry. Pass the enclosing transaction whenever the audited change is itself a
   * write, so the row and its evidence commit or roll back together; omit it for read-only
   * actions such as a login attempt that changed nothing.
   */
  abstract write(entry: AuditEntry, executor?: DatabaseExecutor): Promise<void>;
  abstract list(query?: AuditQuery): Promise<AuditEventPage>;
}

const MAX_AUDIT_PAGE = 200;

@Injectable()
export class DrizzleAuditWriter extends AuditWriter {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async write(entry: AuditEntry, executor: DatabaseExecutor = this.database): Promise<void> {
    await executor.insert(auditEvents).values({
      actorId: entry.actorId,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      outcome: entry.outcome,
      // The request's correlation ID ties the audit row to the structured log lines for the
      // same request. Outside a request (seeds, workers) there is none, so mint one.
      correlationId: getCorrelationId() ?? randomUUID(),
      sourceIp: entry.sourceIp ?? null,
      summary: entry.summary ?? {},
    });
  }

  async list(query: AuditQuery = {}): Promise<AuditEventPage> {
    const filters: SQL[] = [];
    if (query.actorId) filters.push(eq(auditEvents.actorId, query.actorId));
    if (query.action) filters.push(eq(auditEvents.action, query.action));
    // `from` is inclusive and `to` exclusive so a caller can page day-by-day (`from` of one day =
    // `to` of the next) without double-counting the boundary instant. Both hit the composite
    // `(actor, action, occurred_at)` index.
    if (query.from) filters.push(gte(auditEvents.occurredAt, query.from));
    if (query.to) filters.push(lt(auditEvents.occurredAt, query.to));
    const where = filters.length === 0 ? undefined : and(...filters);
    const limit = Math.min(query.limit ?? 100, MAX_AUDIT_PAGE);
    const offset = Math.max(query.offset ?? 0, 0);

    // Counted with the same `where`, so the total can never describe a different query than the
    // rows beside it — the way a count built from a separately assembled filter list eventually
    // does. Both reads hit the `(actor, action, occurred_at)` index.
    const [{ total } = { total: 0 }] = await this.database
      .select({ total: count() })
      .from(auditEvents)
      .where(where);
    const items = await this.database
      .select()
      .from(auditEvents)
      .where(where)
      .orderBy(desc(auditEvents.occurredAt))
      .limit(limit)
      .offset(offset);
    return { items, total, limit, offset };
  }
}
