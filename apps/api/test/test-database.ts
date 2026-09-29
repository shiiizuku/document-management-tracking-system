import type { Database } from '../src/database/client.js';

/**
 * A stand-in for the injected Drizzle `DATABASE` in the full-app REST suites. The only method
 * the domain services call on it directly is `transaction`; every actual read/write goes
 * through a repository, which those suites replace with an in-memory double that ignores the
 * executor argument. So the fake just runs the callback with a throwaway executor.
 */
export const fakeTransactionalDatabase = {
  transaction: async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback({}),
} as unknown as Database;
