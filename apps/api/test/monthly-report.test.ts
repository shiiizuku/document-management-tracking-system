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
