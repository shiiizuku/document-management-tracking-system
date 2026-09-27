import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER } from '@nestjs/core';
import { AuthGuard } from './common/auth.guard.js';
import { HttpErrorFilter } from './common/http-error.filter.js';
import { AdminController } from './modules/admin/admin.controller.js';
import { DtsApplicationService } from './modules/application/dts-application.service.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { DocumentsController } from './modules/documents/documents.controller.js';
import { FilesController } from './modules/files/files.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { ReportsController } from './modules/reports/reports.controller.js';
import { ReportExportService } from './modules/reports/report-export.service.js';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.SESSION_SECRET ?? 'development-only-session-secret-change-me',
      signOptions: { expiresIn: '30m' },
    }),
  ],
  controllers: [
    AuthController,
    DocumentsController,
    FilesController,
    NotificationsController,
    ReportsController,
    AdminController,
    HealthController,
  ],
  providers: [
    DtsApplicationService,
    ReportExportService,
    AuthGuard,
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule {}
