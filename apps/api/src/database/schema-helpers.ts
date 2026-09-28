import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';

export const identityColumns = () => ({
  id: uuid('id').primaryKey().defaultRandom(),
});

export const timestampColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const versionColumn = () => integer('version').notNull().default(1);
