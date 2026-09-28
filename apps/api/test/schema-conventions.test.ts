import { getTableColumns } from 'drizzle-orm';
import { pgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  identityColumns,
  timestampColumns,
  versionColumn,
} from '../src/database/schema-helpers.js';

describe('database schema conventions', () => {
  it('provides UUID identity, managed timestamps, and optimistic version helpers', () => {
    const example = pgTable('schema_convention_example', {
      ...identityColumns(),
      ...timestampColumns(),
      version: versionColumn(),
    });
    const columns = getTableColumns(example);

    expect(columns.id.primary).toBe(true);
    expect(columns.id.hasDefault).toBe(true);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
    expect(columns.updatedAt.onUpdateFn).toBeTypeOf('function');
    expect(columns.version.default).toBe(1);
  });
});
