import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { BUSY_RETRY_AFTER_SECONDS, HttpErrorFilter } from '../src/common/http-error.filter.js';
import { isDatabaseBusyError } from '../src/database/database-errors.js';

// What pg-pool and Postgres actually throw, and how Drizzle wraps them.
const acquireTimeout = () => new Error('timeout exceeded when trying to connect');
const statementTimeout = () =>
  Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });

describe('isDatabaseBusyError', () => {
  it('recognises a pool acquire timeout, bare or wrapped by Drizzle', () => {
    expect(isDatabaseBusyError(acquireTimeout())).toBe(true);
    expect(isDatabaseBusyError(new DrizzleQueryError('select 1', [], acquireTimeout()))).toBe(true);
  });

  it('recognises a statement timeout, wrapped by Drizzle', () => {
    expect(isDatabaseBusyError(new DrizzleQueryError('select 1', [], statementTimeout()))).toBe(
      true,
    );
  });

  it('leaves every other failure alone', () => {
    const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
    expect(isDatabaseBusyError(new DrizzleQueryError('insert', [], uniqueViolation))).toBe(false);
    expect(isDatabaseBusyError(new Error('handler exploded'))).toBe(false);
    expect(isDatabaseBusyError('timeout exceeded when trying to connect')).toBe(false);
  });
});

@Controller()
class SaturatedController {
  @Get('saturated')
  saturated(): never {
    throw new DrizzleQueryError('select count(*) from documents', [], acquireTimeout());
  }
}

describe('HttpErrorFilter at saturation', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('answers 503 with Retry-After instead of a generic 500', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SaturatedController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalFilters(new HttpErrorFilter());
    await app.init();

    const response = await request(app.getHttpServer()).get('/saturated').expect(503);

    expect(response.headers['retry-after']).toBe(String(BUSY_RETRY_AFTER_SECONDS));
    expect(response.body.error).toMatchObject({ code: 'SERVICE_BUSY' });
  });
});
