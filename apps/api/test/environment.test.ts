import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment.js';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://dts:dts@localhost:5432/dts_test',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-characters',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  COOKIE_MAX_AGE_MS: '1800000',
};

describe('environment validation', () => {
  it('fails fast with a clear error when DATABASE_URL is missing', () => {
    expect(() => validateEnvironment({ ...validEnvironment, DATABASE_URL: undefined })).toThrow(
      'DATABASE_URL is required',
    );
  });

  it('rejects an undersized session secret', () => {
    expect(() => validateEnvironment({ ...validEnvironment, SESSION_SECRET: 'too-short' })).toThrow(
      'SESSION_SECRET must be at least 32 characters',
    );
  });

  it('parses validated cookie settings', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      COOKIE_SECURE: false,
      COOKIE_SAME_SITE: 'lax',
      COOKIE_MAX_AGE_MS: 1_800_000,
    });
  });

  it('requires secure cookies in production', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'false',
      }),
    ).toThrow('COOKIE_SECURE must be true in production');
  });

  it('requires the session lifetime to use whole seconds', () => {
    expect(() => validateEnvironment({ ...validEnvironment, COOKIE_MAX_AGE_MS: '1500' })).toThrow(
      'COOKIE_MAX_AGE_MS must be a multiple of 1000',
    );
  });
});
