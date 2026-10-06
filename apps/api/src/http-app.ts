import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { TrustProxySetting } from './config/environment.js';

/**
 * The HTTP edge of the API: proxy trust, cookies, secure headers, the CORS allowlist and the
 * OpenAPI UI. One function so `main.ts` and the security tests configure the same app — a test
 * that rebuilt this by hand would assert its own copy rather than what ships.
 */
export const configureHttpApp = (app: NestExpressApplication): void => {
  const config = app.get(ConfigService);
  // Who `req.ip` is: the rate limiter, the login audit and the lockout all key on it. Off by
  // default; behind the pilot's ingress it must name that hop (`TRUST_PROXY`, environment.ts).
  app.set('trust proxy', config.getOrThrow<TrustProxySetting>('TRUST_PROXY'));
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({ origin: config.getOrThrow<string[]>('WEB_ORIGINS'), credentials: true });
  if (config.getOrThrow<boolean>('API_DOCS')) {
    const openApi = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Document Tracking System API')
        .setDescription(
          'Versioned REST API for document registration, workflow, notifications, audit, and reports.',
        )
        .setVersion('1.0')
        .addCookieAuth('dts_session')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, openApi);
  }
};
