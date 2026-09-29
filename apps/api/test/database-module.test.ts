import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { DATABASE } from '../src/database/database.constants.js';
import { DatabaseModule } from '../src/database/database.module.js';
import type { Database } from '../src/database/client.js';

describe('DatabaseModule', () => {
  it('provides the Drizzle database through the injectable token', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule] }).compile();

    expect(moduleRef.get<Database>(DATABASE)).toBeDefined();

    await moduleRef.close();
  });
});
