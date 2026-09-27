import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

const { db, pool } = createDatabase();
try {
  await migrate(db, { migrationsFolder: './drizzle' });
  process.stdout.write('Migrations applied successfully.\n');
} finally {
  await pool.end();
}
