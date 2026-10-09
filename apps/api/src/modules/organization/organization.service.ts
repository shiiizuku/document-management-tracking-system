import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateDivisionInput,
  CreateDocumentTypeInput,
  HeadOfBureau,
  CreateSectionInput,
  Role,
  UpdateDivisionInput,
  UpdateDocumentTypeInput,
  UpdateSectionInput,
} from '@dts/contracts';
import type { RequestUser } from '../../common/request-user.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { AuthorizationService } from '../authorization/authorization.service.js';
import {
  OrganizationRepository,
  type DivisionRow,
  type DocumentTypeRow,
  type SectionRow,
} from './organization.repository.js';

/** A placement being validated — either an existing user's or one being proposed. */
export interface Placement {
  role: Role;
  divisionId?: string | null | undefined;
  sectionId?: string | null | undefined;
}

export interface ResolvedPlacement {
  divisionId: string | null;
  sectionId: string | null;
}

// Postgres raises this when a unique index is violated. Translating it here turns the one
// genuinely concurrent failure mode — two administrators creating the same code at once —
// into a 409 instead of a 500, without a pre-flight SELECT that would still race.
const UNIQUE_VIOLATION = '23505';
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: string }).code === UNIQUE_VIOLATION;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly repository: OrganizationRepository,
    private readonly authorization: AuthorizationService,
    private readonly audit: AuditWriter,
  ) {}

  async getHeadOfBureau(actor: RequestUser): Promise<HeadOfBureau> {
    this.authorization.assert(actor, 'organization:read');
    return this.repository.getHeadOfBureau();
  }

  async setHeadOfBureau(actor: RequestUser, input: HeadOfBureau): Promise<HeadOfBureau> {
    this.authorization.assert(actor, 'organization:update');
    // The name is a person's and does not belong in the audit trail (`AuditWriter`): it stays in
    // `office_settings`, and the event records only that it changed and who changed it.
    const saved = await this.repository.setHeadOfBureau(input, actor.id, (tx) =>
      this.audit.write(
        {
          actorId: actor.id,
          action: 'office.head-of-bureau-updated',
          targetType: 'office',
          targetId: 'office',
          outcome: 'SUCCESS',
          summary: { fields: ['name', 'title'] },
        },
        tx,
      ),
    );
    return saved;
  }

  async listDivisions(actor: RequestUser): Promise<DivisionRow[]> {
    this.authorization.assert(actor, 'organization:read');
    // Administrators maintain the tree and therefore need to see what they have retired;
    // everyone else only ever picks from what is currently in use.
    return this.repository.listDivisions(this.authorization.can(actor, 'organization:update'));
  }

  async listSections(actor: RequestUser, divisionId?: string): Promise<SectionRow[]> {
    this.authorization.assert(actor, 'organization:read');
    return this.repository.listSections(
      divisionId,
      this.authorization.can(actor, 'organization:update'),
    );
  }

  async createDivision(actor: RequestUser, input: CreateDivisionInput): Promise<DivisionRow> {
    this.authorization.assert(actor, 'organization:create');
    const division = await this.guardUniqueness(
      () => this.repository.insertDivision({ code: input.code, name: input.name }),
      'A division with that code or name already exists',
    );
    await this.audit.write({
      actorId: actor.id,
      action: 'division.created',
      targetType: 'division',
      targetId: division.id,
      outcome: 'SUCCESS',
      summary: { code: division.code },
    });
    return division;
  }

  async updateDivision(
    actor: RequestUser,
    id: string,
    patch: UpdateDivisionInput,
  ): Promise<DivisionRow> {
    this.authorization.assert(actor, 'organization:update');
    const division = await this.guardUniqueness(
      () => this.repository.updateDivision(id, patch),
      'A division with that name already exists',
    );
    if (division === null) throw new NotFoundException('Division not found');
    await this.audit.write({
      actorId: actor.id,
      action: 'division.updated',
      targetType: 'division',
      targetId: division.id,
      outcome: 'SUCCESS',
      summary: { fields: Object.keys(patch), active: division.active },
    });
    return division;
  }

  async createSection(actor: RequestUser, input: CreateSectionInput): Promise<SectionRow> {
    this.authorization.assert(actor, 'organization:create');
    const division = await this.repository.findDivisionById(input.divisionId);
    if (division === null) throw new BadRequestException('The requested division does not exist');
    if (!division.active)
      throw new BadRequestException('Sections cannot be added to an inactive division');
    const section = await this.guardUniqueness(
      () =>
        this.repository.insertSection({
          divisionId: input.divisionId,
          code: input.code,
          name: input.name,
        }),
      'A section with that code or name already exists in this division',
    );
    await this.audit.write({
      actorId: actor.id,
      action: 'section.created',
      targetType: 'section',
      targetId: section.id,
      outcome: 'SUCCESS',
      summary: { code: section.code, divisionId: section.divisionId },
    });
    return section;
  }

  async updateSection(
    actor: RequestUser,
    id: string,
    patch: UpdateSectionInput,
  ): Promise<SectionRow> {
    this.authorization.assert(actor, 'organization:update');
    const section = await this.guardUniqueness(
      () => this.repository.updateSection(id, patch),
      'A section with that name already exists in this division',
    );
    if (section === null) throw new NotFoundException('Section not found');
    await this.audit.write({
      actorId: actor.id,
      action: 'section.updated',
      targetType: 'section',
      targetId: section.id,
      outcome: 'SUCCESS',
      summary: { fields: Object.keys(patch), active: section.active },
    });
    return section;
  }

  async listDocumentTypes(actor: RequestUser): Promise<DocumentTypeRow[]> {
    this.authorization.assert(actor, 'organization:read');
    // As with divisions: administrators see what they retired, everyone else what is offered.
    return this.repository.listDocumentTypes(this.authorization.can(actor, 'organization:update'));
  }

  async createDocumentType(
    actor: RequestUser,
    input: CreateDocumentTypeInput,
  ): Promise<DocumentTypeRow> {
    this.authorization.assert(actor, 'organization:create');
    const type = await this.guardUniqueness(
      () => this.repository.insertDocumentType({ code: input.code, label: input.label }),
      'A document type with that code or name already exists',
    );
    await this.audit.write({
      actorId: actor.id,
      action: 'document-type.created',
      targetType: 'document-type',
      targetId: type.id,
      outcome: 'SUCCESS',
      summary: { code: type.code },
    });
    return type;
  }

  async updateDocumentType(
    actor: RequestUser,
    id: string,
    patch: UpdateDocumentTypeInput,
  ): Promise<DocumentTypeRow> {
    this.authorization.assert(actor, 'organization:update');
    const type = await this.guardUniqueness(
      () => this.repository.updateDocumentType(id, patch),
      'A document type with that name already exists',
    );
    if (type === null) throw new NotFoundException('Document type not found');
    await this.audit.write({
      actorId: actor.id,
      action: 'document-type.updated',
      targetType: 'document-type',
      targetId: type.id,
      outcome: 'SUCCESS',
      summary: { fields: Object.keys(patch), active: type.active },
    });
    return type;
  }

  /**
   * The single place where "is this a legal place to put a person" is decided, so the admin
   * user form, the account-request approval and the seed all agree.
   *
   * Two kinds of rule are checked. Which roles *need* a placement is a shape rule and is also
   * enforced by the shared Zod schemas, so a bad request is rejected before it reaches here;
   * it is repeated because approval merges a request with an administrator's overrides and
   * the merged result is what must be legal. Whether the referenced rows *exist, are active
   * and belong together* can only be answered by the database, so it is only checked here.
   */
  async resolvePlacement(placement: Placement): Promise<ResolvedPlacement> {
    const divisionId = placement.divisionId ?? null;
    const sectionId = placement.sectionId ?? null;
    const needsDivision = placement.role !== 'ADMINISTRATOR' && placement.role !== 'RECORDS_STAFF';
    const needsSection = placement.role === 'STAFF_MEMBER' || placement.role === 'VIEWER';

    if (needsDivision && divisionId === null)
      throw new BadRequestException(`A division is required for the ${placement.role} role`);
    if (needsSection && sectionId === null)
      throw new BadRequestException(`A section is required for the ${placement.role} role`);
    if (sectionId !== null && divisionId === null)
      throw new BadRequestException('A section cannot be assigned without its division');

    if (divisionId !== null) {
      const division = await this.repository.findDivisionById(divisionId);
      if (division === null) throw new BadRequestException('The requested division does not exist');
      if (!division.active)
        throw new BadRequestException('The requested division is no longer active');
    }
    if (sectionId !== null) {
      const section = await this.repository.findSectionById(sectionId);
      if (section === null) throw new BadRequestException('The requested section does not exist');
      if (!section.active)
        throw new BadRequestException('The requested section is no longer active');
      // The rule that makes the org tree meaningful: a person's section must sit under the
      // division they were placed in. Without it a staff member could be given a section from
      // another division and the read policy's section fallback would silently widen.
      if (section.divisionId !== divisionId)
        throw new BadRequestException('The requested section belongs to a different division');
    }
    return { divisionId, sectionId };
  }

  private async guardUniqueness<T>(operation: () => Promise<T>, message: string): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(message);
      throw error;
    }
  }
}
