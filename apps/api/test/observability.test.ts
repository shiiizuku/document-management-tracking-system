import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { Controller, Get, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CORRELATION_ID_HEADER,
  CorrelationIdMiddleware,
  normalizeCorrelationId,
} from '../src/common/correlation-id.middleware.js';
import { getCorrelationId } from '../src/common/request-context.js';
import { REDACTED, StructuredLogger, redact } from '../src/common/structured-logger.js';

@Controller()
class ProbeController {
  @Get('probe')
  probe(): { fromStore: string | undefined } {
    return { fromStore: getCorrelationId() };
  }

  @Get('boom')
  boom(): never {
    throw new Error('handler exploded');
  }
}

describe('correlation id normalization', () => {
  it('keeps a well-formed caller-supplied id', () => {
    expect(normalizeCorrelationId('req-123_abc.def')).toBe('req-123_abc.def');
  });

  it.each([
    ['a newline injection', 'ok\n{"level":"error","message":"forged"}'],
    ['a space-separated payload', 'abc def'],
    ['an over-long value', 'a'.repeat(65)],
    ['an empty value', ''],
    ['a non-string value', 42],
  ])('replaces %s with a generated uuid', (_label, value) => {
    const generated = normalizeCorrelationId(value);
    expect(generated).not.toBe(value);
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('uses the first value when the header is repeated', () => {
    expect(normalizeCorrelationId(['first', 'second'])).toBe('first');
  });
});

describe('correlation id middleware', () => {
  let app: INestApplication;

  const buildApp = async (): Promise<INestApplication> => {
    const { HttpErrorFilter } = await import('../src/common/http-error.filter.js');
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    const created = moduleRef.createNestApplication();
    created.use(new CorrelationIdMiddleware().use.bind(new CorrelationIdMiddleware()));
    created.useGlobalFilters(new HttpErrorFilter());
    await created.init();
    return created;
  };

  afterEach(async () => {
    await app.close();
  });

  it('echoes a valid inbound id on the response and into the async store', async () => {
    app = await buildApp();

    const response = await request(app.getHttpServer())
      .get('/probe')
      .set(CORRELATION_ID_HEADER, 'trace-42')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('trace-42');
    expect(response.body).toEqual({ fromStore: 'trace-42' });
  });

  it('generates an id when none is supplied and keeps header and store in step', async () => {
    app = await buildApp();

    const response = await request(app.getHttpServer()).get('/probe').expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe(response.body.fromStore);
  });

  it('reuses the request id in the error envelope instead of minting a new one', async () => {
    app = await buildApp();

    const response = await request(app.getHttpServer())
      .get('/boom')
      .set(CORRELATION_ID_HEADER, 'trace-99')
      .expect(500);

    expect(response.body.error.correlationId).toBe('trace-99');
    expect(response.headers[CORRELATION_ID_HEADER]).toBe('trace-99');
    expect(response.body.error.message).toBe('An unexpected error occurred');
  });
});

describe('structured logger', () => {
  const parseLine = (line: string | undefined): Record<string, unknown> => {
    if (line === undefined) throw new Error('expected a log line');
    return JSON.parse(line) as Record<string, unknown>;
  };

  const capture = (): {
    lines: string[];
    write: (line: string) => void;
    entry: (index: number) => Record<string, unknown>;
  } => {
    const lines: string[] = [];
    return {
      lines,
      write: (line) => lines.push(line),
      entry: (index) => parseLine(lines[index]),
    };
  };

  it('emits one parseable json object per line with the expected envelope', () => {
    const { lines, entry, write } = capture();
    const logger = new StructuredLogger({
      service: 'dts-api',
      write,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    logger.log('server started', 'Bootstrap');

    expect(lines).toHaveLength(1);
    expect(entry(0)).toEqual({
      timestamp: '2026-01-01T00:00:00.000Z',
      level: 'info',
      service: 'dts-api',
      context: 'Bootstrap',
      message: 'server started',
    });
  });

  it('suppresses entries below the configured level', () => {
    const { lines, write } = capture();
    const logger = new StructuredLogger({ level: 'warn', write });

    logger.debug('noisy');
    logger.log('also noisy');
    logger.warn('kept');

    expect(lines.map((line) => parseLine(line).message)).toEqual(['kept']);
  });

  it('stamps the active correlation id', async () => {
    const { entry, write } = capture();
    const logger = new StructuredLogger({ write });
    const { runWithRequestContext } = await import('../src/common/request-context.js');

    runWithRequestContext({ correlationId: 'trace-7' }, () => {
      logger.error('request failed');
    });

    expect(entry(0)).toMatchObject({ level: 'error', correlationId: 'trace-7' });
  });

  it('redacts secrets in string messages and nested objects', () => {
    const { lines, entry, write } = capture();
    const logger = new StructuredLogger({ write });

    logger.log('login attempt password=hunter2 for user@example.com');
    logger.log({
      user: 'records',
      sessionSecret: 'super-secret-value',
      nested: { authorization: 'Bearer abc.def.ghi', safe: 'keep-me' },
    });

    expect(lines[0]).toContain(`password=${REDACTED}`);
    expect(lines[0]).not.toContain('hunter2');
    expect(entry(1).message).toEqual({
      user: 'records',
      sessionSecret: REDACTED,
      nested: { authorization: REDACTED, safe: 'keep-me' },
    });
  });

  it('survives circular references and serializes errors without losing the stack', () => {
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;

    expect(redact(circular)).toEqual({ name: 'loop', self: '[Circular]' });
    const serialized = redact(new Error('boom token=abc123')) as Record<string, unknown>;
    expect(serialized.message).toBe(`boom token=${REDACTED}`);
    expect(typeof serialized.stack).toBe('string');
  });

  // P-14: user IDs may be logged; names and emails may not.
  describe('P-14 personal data', () => {
    it('removes email addresses from free text', () => {
      const { lines, write } = capture();
      new StructuredLogger({ write }).log(
        'Key (email)=(ana.reyes@mgb.gov.ph) already exists; login attempt for user@example.com',
      );

      expect(lines[0]).not.toContain('ana.reyes@mgb.gov.ph');
      expect(lines[0]).not.toContain('user@example.com');
      expect(lines[0]).toContain(REDACTED);
    });

    it('removes name and email fields but keeps the user id', () => {
      expect(
        redact({
          id: '0192f7c4-0000-7000-8000-000000000001',
          email: 'records@dts.local',
          displayName: 'Records Officer',
          full_name: 'Ana Reyes',
          name: 'TypeError',
        }),
      ).toEqual({
        id: '0192f7c4-0000-7000-8000-000000000001',
        email: REDACTED,
        displayName: REDACTED,
        full_name: REDACTED,
        name: 'TypeError',
      });
    });

    it('redacts an error stack, which repeats the message on its first line', () => {
      const serialized = redact(
        new Error('lookup failed for ana.reyes@mgb.gov.ph password=hunter2'),
      ) as { stack: string };

      expect(serialized.stack).not.toContain('ana.reyes@mgb.gov.ph');
      expect(serialized.stack).not.toContain('hunter2');
      expect(serialized.stack).toContain('at ');
    });
  });
});
