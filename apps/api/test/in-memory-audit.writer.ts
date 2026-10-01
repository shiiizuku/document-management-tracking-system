import type { AuditEntry, AuditEventPage } from '../src/modules/audit/audit.writer.js';
import { AuditWriter } from '../src/modules/audit/audit.writer.js';

/**
 * Collects audit entries in memory so the full-app REST suites can run the authentication
 * flow without a database. Tests can read {@link entries} to assert what was recorded.
 */
export class InMemoryAuditWriter extends AuditWriter {
  readonly entries: AuditEntry[] = [];

  write(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }

  list(): Promise<AuditEventPage> {
    return Promise.resolve({ items: [], total: 0, limit: 100, offset: 0 });
  }
}
