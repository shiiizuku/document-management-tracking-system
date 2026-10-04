import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { TrustProxySetting } from './config/environment.js';
import { StructuredLogger } from './common/structured-logger.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Who `req.ip` is: the rate limiter, the login audit and the lockout all key on it. Off by
  // default; behind the pilot's ingress it must name that hop (`TRUST_PROXY`, environment.ts).
  app.set('trust proxy', app.get(ConfigService).getOrThrow<TrustProxySetting>('TRUST_PROXY'));
  app.useLogger(new StructuredLogger({ service: 'dts-api' }));
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3001').split(','),
    credentials: true,
  });
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
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 4000), '0.0.0.0');
}
void bootstrap();
