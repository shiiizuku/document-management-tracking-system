import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Injectable } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import { sanitizeSpreadsheetCell, type MonthlyReport } from './monthly-report.js';
import type { RoutingSlip, RoutingSlipHop } from '../documents/documents.service.js';

const escapeXml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const columnName = (index: number): string => {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
};

const worksheetXml = (rows: ReadonlyArray<ReadonlyArray<string | number>>): string => {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
          if (typeof value === 'number') return `<c r="${reference}"><v>${value}</v></c>`;
          const style = rowIndex === 0 ? ' s="1"' : '';
          return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData><autoFilter ref="A1:${columnName((rows[0]?.length ?? 1) - 1)}1"/></worksheet>`;
};

/*
 * The bureau's letterhead, verbatim from `Document Routing Slip.doc`, and the QMS-controlled
 * identifier from its footer. `MGBR3-FM-ORD-02` rev 00 is what makes the output *that* form rather
 * than a page resembling it, which is why it belongs on anything printed from here — an office
 * comparing this against the paper one checks the control number first.
 */
const LETTERHEAD = [
  'Republic of the Philippines',
  'Department of Environment and Natural Resources',
  'MINES AND GEOSCIENCES BUREAU',
  'Region III, City of San Fernando, Pampanga',
] as const;

const FORM_CONTROL = 'MGBR3-FM-ORD-02 \u00b7 Rev. 00 \u00b7 08-25-26';

/**
 * The approved seal (decision 64), read once rather than per request.
 *
 * A module-level buffer because the slip is rendered per request and the file would otherwise be
 * read from disk every time. See `apps/api/assets/README.md`: replacing it for another bureau is a
 * deployment step, not a code change.
 */
const SEAL_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../assets/mgb-seal.png');
let sealBytes: Buffer | null | undefined;

const seal = (): Buffer | null => {
  if (sealBytes !== undefined) return sealBytes;
  try {
    sealBytes = readFileSync(SEAL_PATH);
  } catch {
    // A deployment that has not placed a seal still gets a usable slip. The form is identified by
    // its control number, not by the mark.
    sealBytes = null;
  }
  return sealBytes;
};

/** The form prints dates the way the office stamps them: one line, local, no timezone suffix. */
const stamp = (at: Date | null): string =>
  at === null
    ? ''
    : at.toLocaleString('en-PH', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Manila',
      });

/**
 * The ACTION column's text, with any for-information recipients named on a line of their own.
 *
 * "Copied to", never a row: a for-information recipient reads and remarks and never takes custody
 * (decision 160), and giving one a routing row would make the slip read as though three divisions
 * had held the document.
 */
const actionCell = (hop: RoutingSlipHop): string => {
  const copied = hop.copiedTo.length === 0 ? null : `Copied to: ${hop.copiedTo.join(', ')}`;
  const parts = [hop.action === '' ? null : hop.action, copied].filter((part) => part !== null);
  return parts.join('\n');
};

const collectPdf = (build: (document: PDFKit.PDFDocument) => void): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: 'A4', margin: 48, info: { Title: 'DTS report' } });
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    build(document);
    document.end();
  });

@Injectable()
export class ReportExportService {
  monthlyXlsx(report: MonthlyReport): Promise<Buffer> {
    const summaryRows: Array<Array<string | number>> = [
      ['Measure', 'Total'],
      ['Incoming', report.totals.incoming],
      ['Outgoing', report.totals.outgoing],
      ['FOI requests', report.totals.foiRequests],
      ['Special orders', report.totals.specialOrders],
      ['All documents', report.totals.total],
    ];
    const detailRows: Array<Array<string | number>> = [
      ['Title', 'Reference', 'Direction', 'Type', 'Sender', 'Recipients', 'Company', 'Registered'],
      ...report.documents.map((row) => [
        sanitizeSpreadsheetCell(row.title),
        sanitizeSpreadsheetCell(row.referenceNumber ?? ''),
        row.direction,
        sanitizeSpreadsheetCell(row.typeLabel),
        sanitizeSpreadsheetCell(row.sender ?? ''),
        sanitizeSpreadsheetCell(row.recipients.join('; ')),
        sanitizeSpreadsheetCell(row.company ?? ''),
        row.createdAt.toISOString(),
      ]),
    ];
    const files = {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      ),
      'xl/workbook.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Monthly summary" sheetId="1" r:id="rId1"/><sheet name="Documents" sheetId="2" r:id="rId2"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      ),
      'xl/styles.xml': strToU8(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Arial"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Arial"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF175C43"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>',
      ),
      'xl/worksheets/sheet1.xml': strToU8(worksheetXml(summaryRows)),
      'xl/worksheets/sheet2.xml': strToU8(worksheetXml(detailRows)),
    };
    return Promise.resolve(Buffer.from(zipSync(files, { level: 6 })));
  }

  monthlyPdf(report: MonthlyReport): Promise<Buffer> {
    return collectPdf((pdf) => {
      pdf.fillColor('#175c43').fontSize(11).text('DOCUMENT TRACKING SYSTEM');
      pdf.fillColor('#17231e').fontSize(24).text(`Monthly Operational Report`, { paragraphGap: 4 });
      pdf
        .fillColor('#68756f')
        .fontSize(11)
        .text(`${String(report.month).padStart(2, '0')} / ${report.year}`);
      pdf.moveDown(2);
      const totals = [
        ['Incoming', report.totals.incoming],
        ['Outgoing', report.totals.outgoing],
        ['FOI requests', report.totals.foiRequests],
        ['Special orders', report.totals.specialOrders],
        ['Total', report.totals.total],
      ] as const;
      for (const [label, total] of totals) {
        pdf.fillColor('#68756f').fontSize(10).text(label, { continued: true, width: 260 });
        pdf.fillColor('#17231e').fontSize(13).text(String(total), { align: 'right' });
        pdf
          .moveTo(48, pdf.y + 3)
          .lineTo(547, pdf.y + 3)
          .strokeColor('#dcded7')
          .stroke();
        pdf.moveDown(0.7);
      }
      pdf.moveDown().fillColor('#17231e').fontSize(14).text('Documents');
      for (const row of report.documents) {
        pdf.moveDown(0.55).fontSize(10).fillColor('#17231e').text(row.title);
        pdf
          .fontSize(8)
          .fillColor('#68756f')
          .text(`${row.direction} · ${row.typeLabel} · ${row.referenceNumber ?? 'No reference'}`);
        if (row.recipients.length > 0)
          pdf
            .fontSize(8)
            .fillColor('#68756f')
            .text(`To: ${row.recipients.join('; ')}`);
      }
    });
  }

  /**
   * The routing slip, in the bureau's own layout (decisions 170, 171).
   *
   * This replaced a DTS-branded page with a timeline list, and the difference is not cosmetic: the
   * slip is the artefact that travels stapled to the physical document and is compared against the
   * paper form row by row. So it carries that form's letterhead, its metadata table, its five
   * routing columns, its control number and the seal.
   *
   * Laid out by hand with `rect`/`moveTo` rather than through a table helper, because PDFKit has
   * none and the one thing that must not drift is where the vertical rules sit: a routing table
   * whose columns move between pages cannot be read against the paper one.
   */
  routingSlip(slip: RoutingSlip): Promise<Buffer> {
    const { document, addressee, hops } = slip;

    return collectPdf((pdf) => {
      const left = 48;
      const right = 547;
      const width = right - left;

      const mark = seal();
      if (mark !== null) pdf.image(mark, left, 42, { width: 54 });

      pdf.fillColor('#17231e');
      let y = 46;
      LETTERHEAD.forEach((line, index) => {
        const emphasis = index === 2;
        pdf
          .font(emphasis ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(emphasis ? 11 : 9.5)
          .text(line, left, y, { width, align: 'center' });
        y = pdf.y;
      });

      pdf.moveDown(1.2).font('Helvetica-Bold').fontSize(13);
      pdf.text('DOCUMENT ROUTING SLIP', left, pdf.y, { width, align: 'center' });
      pdf.moveDown(0.8);

      /*
       * Eight rows, per decision 171. The scanned sample of the form in use carries five of them —
       * Doc. No., Sender, Subject, Addressee, Date/Time Received — and the remaining three are
       * fields this system holds that the paper form has nowhere to put. Which three is the
       * office's to confirm against the printed form; nothing below depends on the choice.
       */
      const metadata: ReadonlyArray<readonly [string, string]> = [
        ['Doc. No.', document.trackingNumber],
        ['Sender', document.sender ?? ''],
        ['Subject', document.title],
        ['Addressee', addressee ?? ''],
        ['Date/Time Received', stamp(document.createdAt)],
        ['Reference No.', document.referenceNumber ?? ''],
        ['Type', slip.typeLabel],
        ['Target Date', document.dueAt === null ? '' : stamp(document.dueAt)],
      ];

      const labelWidth = 120;
      let top = pdf.y;
      for (const [label, value] of metadata) {
        const valueWidth = width - labelWidth - 12;
        const labelHeight = pdf
          .font('Helvetica-Bold')
          .fontSize(9)
          .heightOfString(label, { width: labelWidth - 8 });
        const valueHeight = pdf
          .font('Helvetica')
          .fontSize(9)
          .heightOfString(value, { width: valueWidth });
        const rowHeight = Math.max(labelHeight, valueHeight) + 8;

        pdf.rect(left, top, width, rowHeight).strokeColor('#17231e').lineWidth(0.6).stroke();
        pdf
          .moveTo(left + labelWidth, top)
          .lineTo(left + labelWidth, top + rowHeight)
          .stroke();
        pdf
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#17231e')
          .text(`${label}:`, left + 4, top + 4, { width: labelWidth - 8 });
        pdf
          .font('Helvetica')
          .fontSize(9)
          .text(value, left + labelWidth + 6, top + 4, { width: valueWidth });
        top += rowHeight;
      }

      pdf.rect(left, top, width, 18).stroke();
      pdf
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#17231e')
        .text('Routing and Action Information', left, top + 5, { width, align: 'center' });
      top += 18;

      // FROM / DATE-TIME RECEIVED / TO / DATE-TIME RELEASED / ACTION TAKEN, at the proportions the
      // paper form uses: the two date columns are fixed and the action column takes what is left.
      const columns = [84, 86, 84, 86, width - 340] as const;
      const headers = [
        'FROM',
        'DATE/TIME RECEIVED',
        'TO',
        'DATE/TIME RELEASED',
        'ACTION REQUIRED/TAKEN/REMARKS/STATUS',
      ] as const;

      const drawRow = (
        cells: readonly string[],
        options: { heading?: boolean; minHeight?: number } = {},
      ) => {
        const heading = options.heading === true;
        const font = heading ? 'Helvetica-Bold' : 'Helvetica';
        const size = heading ? 7.5 : 8.5;
        const heights = cells.map((cell, index) =>
          pdf
            .font(font)
            .fontSize(size)
            .heightOfString(cell, { width: (columns[index] ?? 80) - 8 }),
        );
        const rowHeight = Math.max(options.minHeight ?? 0, ...heights) + 8;

        // A hop that would straddle the page break starts the next page instead, under a repeated
        // header. A routing row split across two sheets cannot be read against the paper form.
        if (top + rowHeight > 760) {
          pdf.addPage();
          top = 48;
          drawRow(headers, { heading: true });
        }

        pdf.rect(left, top, width, rowHeight).strokeColor('#17231e').lineWidth(0.6).stroke();
        let x = left;
        cells.forEach((cell, index) => {
          const columnWidth = columns[index] ?? 80;
          if (index > 0) {
            pdf
              .moveTo(x, top)
              .lineTo(x, top + rowHeight)
              .stroke();
          }
          pdf
            .font(font)
            .fontSize(size)
            .fillColor('#17231e')
            .text(cell, x + 4, top + 4, { width: columnWidth - 8 });
          x += columnWidth;
        });
        top += rowHeight;
      };

      drawRow(headers, { heading: true });

      if (hops.length === 0) {
        drawRow(['', '', '', '', 'This document has not been forwarded.'], { minHeight: 16 });
      }

      for (const hop of hops) {
        drawRow([hop.from, stamp(hop.receivedAt), hop.to, stamp(hop.releasedAt), actionCell(hop)], {
          minHeight: 22,
        });
      }

      pdf
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#68756f')
        .text(FORM_CONTROL, left, Math.min(top + 10, 788), { width, align: 'right' });
    });
  }
}
