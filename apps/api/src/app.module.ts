import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { fileURLToPath } from 'node:url';
import { AuthGuard } from './common/auth.guard.js';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
import { CsrfGuard } from './common/csrf.guard.js';
import { HttpErrorFilter } from './common/http-error.filter.js';
import { AdminController } from './modules/admin/admin.controller.js';
import { DtsApplicationService } from './modules/application/dts-application.service.js';
import { AuditWriter, DrizzleAuditWriter } from './modules/audit/audit.writer.js';
import { DrizzleOutboxWriter, OutboxWriter } from './modules/audit/outbox.writer.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { AuthorizationService } from './modules/authorization/authorization.service.js';
import { DocumentsController } from './modules/documents/documents.controller.js';
import { FilesController } from './modules/files/files.controller.js';
import { HealthController } from './modules/health/health.controller.js';
import { AccountRequestsController } from './modules/identity/account-requests.controller.js';
import { AccountRequestsRepository } from './modules/identity/account-requests.repository.js';
import { IdentityService } from './modules/identity/identity.service.js';
import { MeController } from './modules/identity/me.controller.js';
import { ProfilePhotosRepository } from './modules/identity/profile-photos.repository.js';
import { UsersController } from './modules/identity/users.controller.js';
import { NotificationsController } from './modules/notifications/notifications.controller.js';
import { OrganizationController } from './modules/organization/organization.controller.js';
import { OrganizationRepository } from './modules/organization/organization.repository.js';
import { OrganizationService } from './modules/organization/organization.service.js';
import { ReportsController } from './modules/reports/reports.controller.js';
import { ReportExportService } from './modules/reports/report-export.service.js';
import { validateEnvironment } from './config/environment.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthService } from './modules/auth/auth.service.js';
import { SessionService } from './modules/auth/session.service.js';
import { UsersRepository } from './modules/users/users.repository.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: fileURLToPath(new URL('../../../.env', import.meta.url)),
      validate: validateEnvironment,
    }),
    DatabaseModule,
    // One background limit every route inherits. The unauthenticated endpoints that need a
    // tighter window (login, account requests — decision register 68) override this same
    // bucket per-route with `@Throttle({ default: { … } })`. A second *named* throttler would
    // apply to every route as well, not only the ones that reference it, so the stricter
    // window would leak onto the whole API; a per-route override of the one bucket does not.
    ThrottlerModule.forRoot([{ name: 'default', limit: 120, ttl: 60_000 }]),
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
    AccountRequestsController,
    UsersController,
    MeController,
    OrganizationController,
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
    AccountRequestsRepository,
    ProfilePhotosRepository,
    OrganizationRepository,
    OrganizationService,
    IdentityService,
    AuthorizationService,
    AuthService,
    SessionService,
    ReportExportService,
    AuthGuard,
    CsrfGuard,
    // Abstract classes as tokens: unit suites override these with in-memory writers, the
    // running app and the integration suites get the Postgres-backed ones.
    { provide: AuditWriter, useClass: DrizzleAuditWriter },
    { provide: OutboxWriter, useClass: DrizzleOutboxWriter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
