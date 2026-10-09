import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../src/common/request-user.js';
import type { Role } from '../src/modules/authorization/authorization.policy.js';
import { AuthorizationService } from '../src/modules/authorization/authorization.service.js';
import { capabilitiesByRole } from '../src/modules/authorization/role-capabilities.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import type {
  DivisionRow,
  DocumentTypeRow,
  OrganizationRepository,
  SectionRow,
} from '../src/modules/organization/organization.repository.js';

const actor = (role: Role, overrides: Partial<RequestUser> = {}): RequestUser => ({
  id: 'actor-1',
  email: 'actor@dts.local',
  displayName: 'Actor',
  role,
  divisionId: 'division-a',
  sectionId: 'section-a1',
  capabilities: [...capabilitiesByRole[role]],
  canAccessConfidential: false,
  active: true,
  ...overrides,
});

const division = (overrides: Partial<DivisionRow> = {}): DivisionRow => ({
  id: 'division-a',
  code: 'DIV-A',
  name: 'Division A',
  active: true,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

const section = (overrides: Partial<SectionRow> = {}): SectionRow => ({
  id: 'section-a1',
  divisionId: 'division-a',
  code: 'SEC-A1',
  name: 'Section A1',
  active: true,
  createdAt: new Date('2026-09-28T00:00:00.000Z'),
  updatedAt: new Date('2026-09-28T00:00:00.000Z'),
  ...overrides,
});

const serviceWith = (repo: Partial<OrganizationRepository>) => {
  const listDivisions = vi.fn().mockResolvedValue([]);
  const repository = { listDivisions, ...repo } as unknown as OrganizationRepository;
  const write = vi.fn().mockResolvedValue(undefined);
  const service = new OrganizationService(repository, new AuthorizationService(), {
    write,
    list: vi.fn(),
  });
  return { service, listDivisions, write };
};

describe('OrganizationService.resolvePlacement (membership rules)', () => {
  it('accepts records staff and administrators with no placement at all', async () => {
    const { service } = serviceWith({});
    await expect(service.resolvePlacement({ role: 'RECORDS_STAFF' })).resolves.toEqual({
      divisionId: null,
      sectionId: null,
    });
  });

  it('requires a section for a staff member', async () => {
    const { service } = serviceWith({
      findDivisionById: vi.fn().mockResolvedValue(division()),
    });
    await expect(
      service.resolvePlacement({ role: 'STAFF_MEMBER', divisionId: 'division-a' }),
    ).rejects.toThrow(new BadRequestException('A section is required for the STAFF_MEMBER role'));
  });

  it('rejects a section that belongs to a different division', async () => {
    const { service } = serviceWith({
      findDivisionById: vi.fn().mockResolvedValue(division()),
      findSectionById: vi.fn().mockResolvedValue(section({ divisionId: 'division-b' })),
    });
    await expect(
      service.resolvePlacement({
        role: 'STAFF_MEMBER',
        divisionId: 'division-a',
        sectionId: 'section-a1',
      }),
    ).rejects.toThrow(
      new BadRequestException('The requested section belongs to a different division'),
    );
  });

  it('rejects placement into an inactive division', async () => {
    const { service } = serviceWith({
      findDivisionById: vi.fn().mockResolvedValue(division({ active: false })),
    });
    await expect(
      service.resolvePlacement({ role: 'DIVISION_HEAD', divisionId: 'division-a' }),
    ).rejects.toThrow(new BadRequestException('The requested division is no longer active'));
  });

  it('returns the validated placement for a well-formed staff member', async () => {
    const { service } = serviceWith({
      findDivisionById: vi.fn().mockResolvedValue(division()),
      findSectionById: vi.fn().mockResolvedValue(section()),
    });
    await expect(
      service.resolvePlacement({
        role: 'STAFF_MEMBER',
        divisionId: 'division-a',
        sectionId: 'section-a1',
      }),
    ).resolves.toEqual({ divisionId: 'division-a', sectionId: 'section-a1' });
  });
});

describe('OrganizationService authorization', () => {
  it('forbids a non-administrator from creating a division', async () => {
    const { service } = serviceWith({ insertDivision: vi.fn() });
    await expect(
      service.createDivision(actor('DIVISION_HEAD'), { code: 'X', name: 'X' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('shows retired divisions only to an administrator who can manage them', async () => {
    const { service, listDivisions } = serviceWith({});

    await service.listDivisions(actor('ADMINISTRATOR'));
    expect(listDivisions).toHaveBeenLastCalledWith(true);

    await service.listDivisions(actor('STAFF_MEMBER'));
    expect(listDivisions).toHaveBeenLastCalledWith(false);
  });
});

describe('OrganizationService head of bureau', () => {
  it('lets an administrator name the Head of the Bureau and audits it', async () => {
    // Runs the audit callback the way the repository does, inside its transaction.
    const setHeadOfBureau = vi
      .fn()
      .mockImplementation(
        async (value: unknown, _by: string, audit: (tx: never) => Promise<void>) => {
          await audit({} as never);
          return value;
        },
      );
    const { service, write } = serviceWith({ setHeadOfBureau });

    const saved = await service.setHeadOfBureau(actor('ADMINISTRATOR'), {
      name: 'Engr. Maria Santos',
      title: 'Regional Director',
    });

    expect(saved).toEqual({ name: 'Engr. Maria Santos', title: 'Regional Director' });
    expect(setHeadOfBureau).toHaveBeenCalledWith(saved, 'actor-1', expect.any(Function));
    // Recorded without the personal name, and inside the same transaction as the change.
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'office.head-of-bureau-updated',
        outcome: 'SUCCESS',
        summary: { fields: ['name', 'title'] },
      }),
      {},
    );
  });

  it('refuses everyone else, who may read it but not change it', async () => {
    const getHeadOfBureau = vi.fn().mockResolvedValue({ name: '', title: 'Regional Director' });
    const { service } = serviceWith({ getHeadOfBureau, setHeadOfBureau: vi.fn() });

    await expect(
      service.setHeadOfBureau(actor('RECORDS_STAFF'), { name: 'X', title: 'Y' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getHeadOfBureau(actor('RECORDS_STAFF'))).resolves.toEqual({
      name: '',
      title: 'Regional Director',
    });
  });
});

describe('OrganizationService document types', () => {
  const documentType = (overrides: Partial<DocumentTypeRow> = {}): DocumentTypeRow => ({
    id: 'type-1',
    code: 'NOTICE_OF_VIOLATION',
    label: 'Notice of violation',
    active: true,
    sortOrder: 6,
    createdAt: new Date('2026-10-09T00:00:00.000Z'),
    updatedAt: new Date('2026-10-09T00:00:00.000Z'),
    ...overrides,
  });

  it('lets an administrator add a type, and audits it', async () => {
    const insertDocumentType = vi.fn().mockResolvedValue(documentType());
    const { service, write } = serviceWith({ insertDocumentType });

    const created = await service.createDocumentType(actor('ADMINISTRATOR'), {
      code: 'NOTICE_OF_VIOLATION',
      label: 'Notice of violation',
    });

    expect(created.code).toBe('NOTICE_OF_VIOLATION');
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document-type.created', targetId: 'type-1' }),
    );
  });

  it('refuses a non-administrator', async () => {
    const insertDocumentType = vi.fn();
    const { service } = serviceWith({ insertDocumentType });

    await expect(
      service.createDocumentType(actor('RECORDS_STAFF'), { code: 'X_TYPE', label: 'X type' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(insertDocumentType).not.toHaveBeenCalled();
  });

  it('turns a duplicate code or name into a conflict', async () => {
    const insertDocumentType = vi.fn().mockRejectedValue({ code: '23505' });
    const { service } = serviceWith({ insertDocumentType });

    await expect(
      service.createDocumentType(actor('ADMINISTRATOR'), { code: 'LETTER', label: 'Letter' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('shows retired types to administrators only', async () => {
    const listDocumentTypes = vi.fn().mockResolvedValue([]);
    const { service } = serviceWith({ listDocumentTypes });

    await service.listDocumentTypes(actor('ADMINISTRATOR'));
    await service.listDocumentTypes(actor('STAFF_MEMBER'));

    expect(listDocumentTypes).toHaveBeenNthCalledWith(1, true);
    expect(listDocumentTypes).toHaveBeenNthCalledWith(2, false);
  });
});
