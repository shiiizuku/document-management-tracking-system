import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import { users } from '../../database/schema.js';

export type UserRow = typeof users.$inferSelect;

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findByEmail(email: string): Promise<UserRow | null> {
    const user = await this.database.query.users.findFirst({
      where: eq(users.email, email.trim().toLowerCase()),
    });
    return user ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const user = await this.database.query.users.findFirst({ where: eq(users.id, id) });
    return user ?? null;
  }
}
