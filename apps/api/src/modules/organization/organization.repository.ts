import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../database/client.js';
import { DATABASE } from '../../database/database.constants.js';
import type { DatabaseExecutor } from '../../database/executor.js';
import { divisions, documentTypes, officeSettings, sections } from '../../database/schema.js';

export type DivisionRow = typeof divisions.$inferSelect;
export type SectionRow = typeof sections.$inferSelect;
export type DocumentTypeRow = typeof documentTypes.$inferSelect;

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

  /** The Head of the Bureau. The row is created by migration `0015`; a missing one reads as blank. */
  async getHeadOfBureau(): Promise<{ name: string; title: string }> {
    const [row] = await this.database.select().from(officeSettings).where(eq(officeSettings.id, 1));
    return {
      name: row?.headOfBureauName ?? '',
      title: row?.headOfBureauTitle ?? 'Regional Director',
    };
  }

  /**
   * Saves the Head of the Bureau and runs `audit` in the same transaction, so a change cannot
   * commit without its audit event or the reverse.
   */
  async setHeadOfBureau(
    value: { name: string; title: string },
    updatedById: string,
    audit: (executor: DatabaseExecutor) => Promise<void>,
  ): Promise<{ name: string; title: string }> {
    const set = {
      headOfBureauName: value.name,
      headOfBureauTitle: value.title,
      updatedById,
      updatedAt: new Date(),
    };
    await this.database.transaction(async (tx) => {
      await tx
        .insert(officeSettings)
        .values({ id: 1, ...set })
        .onConflictDoUpdate({ target: officeSettings.id, set });
      await audit(tx);
    });
    return value;
  }

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

  async listDocumentTypes(includeInactive = false): Promise<DocumentTypeRow[]> {
    return this.database
      .select()
      .from(documentTypes)
      .where(includeInactive ? undefined : eq(documentTypes.active, true))
      .orderBy(asc(documentTypes.sortOrder), asc(documentTypes.label));
  }

  /** New types sort after every existing one, so adding a type never reorders the list. */
  async insertDocumentType(values: { code: string; label: string }): Promise<DocumentTypeRow> {
    const [{ next } = { next: 1 }] = await this.database
      .select({ next: sql<number>`coalesce(max(${documentTypes.sortOrder}), 0) + 1` })
      .from(documentTypes);
    const [row] = await this.database
      .insert(documentTypes)
      .values({ ...values, sortOrder: next })
      .returning();
    if (!row) throw new Error('Insert of a document type returned no row');
    return row;
  }

  async updateDocumentType(
    id: string,
    patch: { label?: string | undefined; active?: boolean | undefined },
  ): Promise<DocumentTypeRow | null> {
    const [row] = await this.database
      .update(documentTypes)
      .set(patch)
      .where(eq(documentTypes.id, id))
      .returning();
    return row ?? null;
  }
}
