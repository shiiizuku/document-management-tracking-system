import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { DocumentsService } from '../documents/documents.service.js';
import { AuditWriter } from '../audit/audit.writer.js';
import { ReportExportService } from './report-export.service.js';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly exports: ReportExportService,
    private readonly audit: AuditWriter,
  ) {}

  @Get('monthly')
  async monthly(
    @CurrentUser() actor: RequestUser,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const { reportYear, reportMonth } = this.period(year, month);
    return { data: await this.documents.monthlyReport(actor, reportYear, reportMonth) };
  }

  @Get('monthly.xlsx')
  async monthlyXlsx(
    @CurrentUser() actor: RequestUser,
    @Res() response: Response,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<void> {
    const { reportYear, reportMonth } = this.period(year, month);
    const report = await this.documents.monthlyReport(actor, reportYear, reportMonth);
    const content = await this.exports.monthlyXlsx(report);
    await this.auditExport(actor, 'xlsx', reportYear, reportMonth);
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="dts-monthly-${reportYear}-${String(reportMonth).padStart(2, '0')}.xlsx"`,
    );
    response.send(content);
  }

  @Get('monthly.pdf')
  async monthlyPdf(
    @CurrentUser() actor: RequestUser,
    @Res() response: Response,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<void> {
    const { reportYear, reportMonth } = this.period(year, month);
    const report = await this.documents.monthlyReport(actor, reportYear, reportMonth);
    const content = await this.exports.monthlyPdf(report);
    await this.auditExport(actor, 'pdf', reportYear, reportMonth);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="dts-monthly-${reportYear}-${String(reportMonth).padStart(2, '0')}.pdf"`,
    );
    response.send(content);
  }

  /**
   * Records that a report file left the system. A downloaded file can be forwarded outside the
   * office, so an export is a distinct, auditable event from the on-screen `report.monthly-viewed`
   * that `DocumentsService.monthlyReport` already writes. Format and period only — no row data.
   */
  private auditExport(
    actor: RequestUser,
    format: 'pdf' | 'xlsx',
    year: number,
    month: number,
  ): Promise<void> {
    return this.audit.write({
      actorId: actor.id,
      action: 'report.exported',
      targetType: 'report',
      targetId: `${year}-${month}`,
      outcome: 'SUCCESS',
      summary: { format, year, month },
    });
  }

  private period(year?: string, month?: string): { reportYear: number; reportMonth: number } {
    const now = new Date();
    return {
      reportYear: year ? Number(year) : now.getUTCFullYear(),
      reportMonth: month ? Number(month) : now.getUTCMonth() + 1,
    };
  }
}
