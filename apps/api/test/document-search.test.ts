import { describe, expect, it } from 'vitest';
import { AuthorizationPolicy } from '../src/modules/authorization/authorization.policy.js';
import {
  DocumentSearchService,
  type SearchableDocument,
} from '../src/modules/documents/document-search.service.js';

const documents: SearchableDocument[] = [
  {
    id: 'a',
    title: 'Budget memorandum',
    trackingNumber: 'DTS-2026-0001',
    referenceNumber: 'EXT-ALPHA',
    sender: 'Alice Reyes',
    company: 'Alpha Agency',
    description: 'The hidden phrase exists only in body content.',
    status: 'IN_PROCESS',
    priority: 'HIGH',
    type: 'MEMORANDUM',
    direction: 'INCOMING',
    divisionId: 'division-a',
    sectionId: 'section-a1',
    assigneeUserIds: [],
    sharedUserIds: [],
    confidential: false,
    createdAt: new Date('2026-01-02T00:00:00Z'),
  },
  {
    id: 'b',
    title: 'Special order',
    trackingNumber: 'DTS-2026-0002',
    referenceNumber: 'OUT-BETA',
    sender: 'Records Office',
    company: 'Beta Bureau',
    description: 'ordinary description',
    status: 'RELEASED',
    priority: 'NORMAL',
    type: 'SPECIAL_ORDER',
    direction: 'OUTGOING',
    divisionId: 'division-b',
    sectionId: 'section-b1',
    assigneeUserIds: [],
    sharedUserIds: [],
    confidential: false,
    createdAt: new Date('2026-01-03T00:00:00Z'),
  },
];

const sameSectionActor = {
  id: 'staff-a',
  role: 'STAFF_MEMBER' as const,
  divisionId: 'division-a',
  sectionId: 'section-a1',
  capabilities: [],
  canAccessConfidential: false,
};

describe('DocumentSearchService public seam', () => {
  const search = new DocumentSearchService(new AuthorizationPolicy());

  it.each(['budget', 'DTS-2026-0001', 'EXT-ALPHA', 'alice', 'alpha agency'])(
    'matches supported metadata field %s',
    (term) => {
      expect(
        search.execute(sameSectionActor, documents, { search: term }).items.map((item) => item.id),
      ).toEqual(['a']);
    },
  );

  it('does not search description or attachment content', () => {
    expect(search.execute(sameSectionActor, documents, { search: 'hidden phrase' }).total).toBe(0);
  });

  it('applies authorization before totals and pagination', () => {
    const result = search.execute(sameSectionActor, documents, { page: 1, pageSize: 10 });
    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.id)).toEqual(['a']);
  });

  it('combines filters and deterministic sorting', () => {
    const recordsActor = { ...sameSectionActor, role: 'RECORDS_STAFF' as const };
    const result = search.execute(recordsActor, documents, {
      direction: 'OUTGOING',
      status: 'RELEASED',
      sort: 'createdAt',
      order: 'desc',
      page: 1,
      pageSize: 1,
    });
    expect(result).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(result.items.map((item) => item.id)).toEqual(['b']);
  });
});
