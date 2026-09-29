import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_FILTER } from '@nestjs/core';
import { fileURLToPath } from 'node:url';
import { AuthGuard } from './common/auth.guard.js';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
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
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthService } from './modules/auth/auth.service.js';
import { UsersRepository } from './modules/users/users.repository.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: fileURLToPath(new URL('../../../.env', import.meta.url)),
      validate: validateEnvironment,
    }),
    DatabaseModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('SESSION_SECRET'),
        signOptions: {
          expiresIn: config.getOrThrow<number>('COOKIE_MAX_AGE_MS') / 1000,
        },
      }),
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
    UsersRepository,
    AuthService,
    ReportExportService,
    AuthGuard,
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
