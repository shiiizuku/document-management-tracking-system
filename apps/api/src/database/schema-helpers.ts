import { customType, integer, timestamp, uuid } from 'drizzle-orm/pg-core';

export const identityColumns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
});

// `drizzle-orm/pg-core` ships no `bytea` column, and node-postgres already hands back a
// Buffer for it, so the driver mapping is the identity function in both directions.
export const customBytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const timestampColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const versionColumn = () => integer('version').notNull().default(1);
