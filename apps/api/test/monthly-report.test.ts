import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import {
  sanitizeSpreadsheetCell,
  type MonthlyReport,
  type ReportDocument,
} from '../src/modules/reports/monthly-report.js';
import { ReportExportService } from '../src/modules/reports/report-export.service.js';

const row = (overrides: Partial<ReportDocument>): ReportDocument => ({
  id: 'document-1',
  title: 'Quarterly update',
  referenceNumber: 'REF-1',
  sender: 'Citizen',
  recipients: [],
  company: 'Public',
  type: 'MEMORANDUM',
  direction: 'INCOMING',
  divisionId: 'division-a',
  sectionId: 'section-a1',
  confidential: false,
  createdAt: new Date('2026-09-15T03:00:00Z'),
  ...overrides,
});

/**
 * A report as `DocumentsService.monthlyReport` hands it to the exporter.
 *
 * Built literally rather than through a builder, because there is no longer a builder to go
 * through: the service assembles the report itself from rows already scoped in SQL. What the
 * exporter needs is a `MonthlyReport`, and this is one.
 */
const report = (documents: ReportDocument[]): MonthlyReport => ({
  year: 2026,
  month: 9,
  totals: {
    incoming: documents.filter((document) => document.direction === 'INCOMING').length,
    outgoing: documents.filter((document) => document.direction === 'OUTGOING').length,
    foiRequests: documents.filter((document) => document.type === 'FOI_REQUEST').length,
    specialOrders: documents.filter((document) => document.type === 'SPECIAL_ORDER').length,
    total: documents.length,
  },
  documents,
});

describe('monthly report exports', () => {
  /*
   * Registry text reaches a spreadsheet cell verbatim, and Excel executes a cell that opens with
   * `=`, `+`, `-` or `@`. That makes a document title an injection path into whatever machine
   * opens the export, which is why this is asserted on the sanitizer directly as well as through
   * a rendered workbook below.
   */
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

  it('creates a structurally valid XLSX with user text stored as literal cells', async () => {
    const workbook = await new ReportExportService().monthlyXlsx(
      report([row({ title: '=HYPERLINK("https://invalid")' })]),
    );
    const archive = unzipSync(workbook);
    expect(Object.keys(archive)).toContain('xl/worksheets/sheet2.xml');
    const detailSheet = archive['xl/worksheets/sheet2.xml'];
    expect(detailSheet).toBeDefined();
    const xml = strFromU8(detailSheet!);
    expect(xml).not.toContain('<f>');
    expect(xml).toContain('&apos;=HYPERLINK');
  });
});
