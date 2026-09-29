import type { Database } from './client.js';

/**
 * A transaction handle as Drizzle hands it to a `db.transaction` callback. Deriving it from
 * the client keeps the schema generics in one place: writing them out by hand means every
 * new table changes the type.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * Anything that can run a statement — the pool or an open transaction. Repositories and
 * writers take this so a use case can compose them into a single transaction (one DB
 * transaction per state change: domain row + workflow_event + audit_event + outbox_event),
 * while a plain read can pass the pool and skip the ceremony.
 */
export type DatabaseExecutor = Database | Transaction;
