import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { divisions, sections } from '../../database/schema.js';

export type DivisionRow = typeof divisions.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;

// `exactOptionalPropertyTypes` is on, so a patch built from an optional Zod field carries
// `| undefined` explicitly; Drizzle's `set` ignores undefined keys, which is the behaviour a
// partial update wants.
export interface OrganizationPatch {
  name?: string | undefined;
  active?: boolean | undefined;
}

@Injectable()
export class OrganizationRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async listDivisions(includeInactive = false): Promise<DivisionRow[]> {
    return this.database
      .select()
      .from(divisions)
      .where(includeInactive ? undefined : eq(divisions.active, true))
      .orderBy(asc(divisions.name));
  }

  async findDivisionById(id: string): Promise<DivisionRow | null> {
    const [division] = await this.database.select().from(divisions).where(eq(divisions.id, id));
    return division ?? null;
  }

  async findDivisionByCode(code: string): Promise<DivisionRow | null> {
    const [division] = await this.database.select().from(divisions).where(eq(divisions.code, code));
    return division ?? null;
  }

  async insertDivision(
    values: { code: string; name: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<DivisionRow> {
    const [division] = await executor.insert(divisions).values(values).returning();
    if (!division) throw new Error('Insert of a division returned no row');
    return division;
  }

  async updateDivision(
    id: string,
    patch: OrganizationPatch,
    executor: DatabaseExecutor = this.database,
  ): Promise<DivisionRow | null> {
    const [division] = await executor
      .update(divisions)
      .set(patch)
      .where(eq(divisions.id, id))
      .returning();
    return division ?? null;
  }

  async listSections(divisionId?: string, includeInactive = false): Promise<SectionRow[]> {
    const filters = [
      divisionId === undefined ? undefined : eq(sections.divisionId, divisionId),
      includeInactive ? undefined : eq(sections.active, true),
    ].filter((filter): filter is Exclude<typeof filter, undefined> => filter !== undefined);
    return this.database
      .select()
      .from(sections)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(asc(sections.name));
  }

  async findSectionById(id: string): Promise<SectionRow | null> {
    const [section] = await this.database.select().from(sections).where(eq(sections.id, id));
    return section ?? null;
  }

  async insertSection(
    values: { divisionId: string; code: string; name: string },
    executor: DatabaseExecutor = this.database,
  ): Promise<SectionRow> {
    const [section] = await executor.insert(sections).values(values).returning();
    if (!section) throw new Error('Insert of a section returned no row');
    return section;
  }

  async updateSection(
    id: string,
    patch: OrganizationPatch,
    executor: DatabaseExecutor = this.database,
  ): Promise<SectionRow | null> {
    const [section] = await executor
      .update(sections)
      .set(patch)
      .where(eq(sections.id, id))
      .returning();
    return section ?? null;
  }
}
