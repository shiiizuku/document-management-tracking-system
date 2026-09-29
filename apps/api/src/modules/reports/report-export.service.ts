import { Injectable } from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import PDFDocument from 'pdfkit';
import { sanitizeSpreadsheetCell, type MonthlyReport } from './monthly-report.service.js';
import type { PublicDocument, TimelineEntry } from '../documents/documents.service.js';

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
      ['Title', 'Reference', 'Direction', 'Type', 'Sender', 'Company', 'Registered'],
      ...report.documents.map((row) => [
        sanitizeSpreadsheetCell(row.title),
        sanitizeSpreadsheetCell(row.referenceNumber ?? ''),
        row.direction,
        sanitizeSpreadsheetCell(row.type),
        sanitizeSpreadsheetCell(row.sender ?? ''),
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
          .text(`${row.direction} · ${row.type} · ${row.referenceNumber ?? 'No reference'}`);
      }
    });
  }

  routingSlip(document: PublicDocument, timeline: TimelineEntry[]): Promise<Buffer> {
    return collectPdf((pdf) => {
      pdf.fillColor('#175c43').fontSize(11).text('DOCUMENT TRACKING SYSTEM');
      pdf.fillColor('#17231e').fontSize(25).text('Routing Slip');
      pdf.moveDown().fontSize(15).text(document.title);
      pdf
        .fontSize(9)
        .fillColor('#68756f')
        .text(
          `${document.trackingNumber} · ${document.referenceNumber ?? 'No external reference'}`,
        );
      pdf
        .moveDown()
        .fillColor('#17231e')
        .fontSize(10)
        .text(`Status: ${document.status.replaceAll('_', ' ')}`);
      pdf.text(`Direction: ${document.direction}    Priority: ${document.priority}`);
      pdf.text(`Sender: ${document.sender ?? '—'}    Company: ${document.company ?? '—'}`);
      pdf.moveDown(1.5).fontSize(14).text('Timeline');
      if (timeline.length === 0)
        pdf.moveDown().fontSize(10).fillColor('#68756f').text('No workflow actions recorded.');
      for (const event of timeline) {
        pdf
          .moveDown(0.8)
          .fillColor('#17231e')
          .fontSize(10)
          .text(`${event.action.replaceAll('_', ' ')} · ${event.toStatus.replaceAll('_', ' ')}`);
        pdf.fontSize(8).fillColor('#68756f').text(event.occurredAt.toISOString());
        if (event.remarks) pdf.fontSize(9).fillColor('#17231e').text(`Remarks: ${event.remarks}`);
      }
    });
  }
}
