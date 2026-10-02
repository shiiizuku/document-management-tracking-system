import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  MonthlyReportService,
  sanitizeSpreadsheetCell,
  type ReportDocument,
} from '../src/modules/reports/monthly-report.service.js';
import { AuthorizationPolicy } from '../src/modules/authorization/authorization.policy.js';
import { ReportExportService } from '../src/modules/reports/report-export.service.js';

const recordsActor = {
  id: 'records-1',
  role: 'RECORDS_STAFF' as const,
  divisionId: null,
  sectionId: null,
  capabilities: ['REPORT_VIEW'],
  canAccessConfidential: true,
};

const row = (overrides: Partial<ReportDocument>): ReportDocument => ({
  id: 'document-1',
  title: 'Quarterly update',
  referenceNumber: 'REF-1',
  sender: 'Citizen',
  company: 'Public',
  type: 'MEMORANDUM',
  direction: 'INCOMING',
  divisionId: 'division-a',
  sectionId: 'section-a1',
  assigneeUserIds: [],
  sharedUserIds: [],
  confidential: false,
  createdAt: new Date('2026-09-15T03:00:00Z'),
  ...overrides,
});

describe('MonthlyReportService public seam', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-1+2', '@cmd', '\t=HYPERLINK("https://invalid")'])(
    'neutralizes spreadsheet formula input %s',
    (value) => {
      const safe = sanitizeSpreadsheetCell(value);
      expect(safe.startsWith("'")).toBe(true);
      expect(safe.slice(1)).toBe(value);
    },
  );

  it('leaves ordinary text unchanged', () => {
    expect(sanitizeSpreadsheetCell('Reference 123')).toBe('Reference 123');
  });

  it('reconciles monthly totals from authorized source rows', () => {
    const service = new MonthlyReportService(new AuthorizationPolicy());
    const rows = [
      row({ id: 'incoming', direction: 'INCOMING' }),
      row({ id: 'outgoing', direction: 'OUTGOING' }),
      row({ id: 'foi', type: 'FOI_REQUEST' }),
      row({ id: 'special', type: 'SPECIAL_ORDER', direction: 'OUTGOING' }),
      row({ id: 'other-month', createdAt: new Date('2026-08-31T23:59:59Z') }),
    ];

    expect(service.calculate(recordsActor, rows, 2026, 9).totals).toEqual({
      incoming: 2,
      outgoing: 2,
      foiRequests: 1,
      specialOrders: 1,
      total: 4,
    });
  });

  it('does not count unauthorized rows', () => {
    const service = new MonthlyReportService(new AuthorizationPolicy());
    const staff = {
      ...recordsActor,
      role: 'STAFF_MEMBER' as const,
      divisionId: 'division-a',
      sectionId: 'section-a1',
    };
    const result = service.calculate(
      staff,
      [
        row({ id: 'visible' }),
        row({ id: 'hidden', divisionId: 'division-b', sectionId: 'section-b1' }),
      ],
      2026,
      9,
    );
    expect(result.totals.total).toBe(1);
  });

  /*
   * The companion to the case above: being out of division is not the same as being out of reach.
   * A division head assigned a document in another division may read it, so it belongs on their
   * report — and `calculate` can only know that from the assignment its caller supplies. Pinned
   * here because the arrays this depends on are the easiest thing for a caller to leave empty,
   * and the result would be a report quietly missing rows rather than a failure.
   *
   * `documents.int.test.ts` asserts the same case over the shipped path and real SQL.
   */
  it('counts a document from another division that the actor is assigned to', () => {
    const service = new MonthlyReportService(new AuthorizationPolicy());
    const divisionHead = {
      ...recordsActor,
      id: 'head-1',
      role: 'DIVISION_HEAD' as const,
      divisionId: 'division-a',
      sectionId: null,
    };

    const result = service.calculate(
      divisionHead,
      [
        row({ id: 'own-division' }),
        row({ id: 'assigned-elsewhere', divisionId: 'division-b', sectionId: 'section-b1' }),
      ].map((document) =>
        document.id === 'assigned-elsewhere'
          ? { ...document, assigneeUserIds: [divisionHead.id] }
          : document,
      ),
      2026,
      9,
    );

    expect(result.documents.map((document) => document.id)).toEqual([
      'own-division',
      'assigned-elsewhere',
    ]);
    expect(result.totals.total).toBe(2);
  });

  it('counts a document from another division that was shared with the actor', () => {
    const service = new MonthlyReportService(new AuthorizationPolicy());
    const divisionHead = {
      ...recordsActor,
      id: 'head-1',
      role: 'DIVISION_HEAD' as const,
      divisionId: 'division-a',
      sectionId: null,
    };

    const result = service.calculate(
      divisionHead,
      [
        row({
          id: 'shared-elsewhere',
          divisionId: 'division-b',
          sectionId: 'section-b1',
          sharedUserIds: [divisionHead.id],
        }),
      ],
      2026,
      9,
    );

    expect(result.totals.total).toBe(1);
  });

  it('creates a structurally valid XLSX with user text stored as literal cells', async () => {
    const service = new MonthlyReportService(new AuthorizationPolicy());
    const report = service.calculate(
      recordsActor,
      [row({ title: '=HYPERLINK("https://invalid")' })],
      2026,
      9,
    );
    const workbook = await new ReportExportService().monthlyXlsx(report);
    const archive = unzipSync(workbook);
    expect(Object.keys(archive)).toContain('xl/worksheets/sheet2.xml');
    const detailSheet = archive['xl/worksheets/sheet2.xml'];
    expect(detailSheet).toBeDefined();
    const xml = strFromU8(detailSheet!);
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('&apos;=HYPERLINK');
  });
});
