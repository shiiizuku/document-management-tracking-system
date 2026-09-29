import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { DtsApplicationService } from '../application/dts-application.service.js';
import { ReportExportService } from './report-export.service.js';

@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(
    private readonly application: DtsApplicationService,
    private readonly exports: ReportExportService,
  ) {}

  @Get('monthly')
  monthly(
    @CurrentUser() actor: RequestUser,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const { reportYear, reportMonth } = this.period(year, month);
    return { data: this.application.monthlyReport(actor, reportYear, reportMonth) };
  }

  @Get('monthly.xlsx')
  async monthlyXlsx(
    @CurrentUser() actor: RequestUser,
    @Res() response: Response,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<void> {
    const { reportYear, reportMonth } = this.period(year, month);
    const report = this.application.monthlyReport(actor, reportYear, reportMonth);
    const content = await this.exports.monthlyXlsx(report);
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
    const report = this.application.monthlyReport(actor, reportYear, reportMonth);
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="dts-monthly-${reportYear}-${String(reportMonth).padStart(2, '0')}.pdf"`,
    );
    response.send(await this.exports.monthlyPdf(report));
  }

  private period(year?: string, month?: string): { reportYear: number; reportMonth: number } {
    const now = new Date();
    return {
      reportYear: year ? Number(year) : now.getUTCFullYear(),
      reportMonth: month ? Number(month) : now.getUTCMonth() + 1,
    };
  }
}
