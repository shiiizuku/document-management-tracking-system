import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','),
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
