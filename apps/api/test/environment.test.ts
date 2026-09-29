import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/config/environment.js';

const validEnvironment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://dts:dts@localhost:5432/dts_test',
  REDIS_URL: 'redis://localhost:6379',
  MINIO_ENDPOINT: 'http://localhost:9000',
  MINIO_ACCESS_KEY: 'dts-local',
  MINIO_SECRET_KEY: 'test-minio-secret',
  MINIO_BUCKET: 'dts-files',
  CLAMAV_HOST: 'localhost',
  CLAMAV_PORT: '3310',
  SESSION_SECRET: 'a-session-secret-that-is-at-least-32-characters',
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  COOKIE_MAX_AGE_MS: '1800000',
  UPLOAD_MAX_BYTES: '26214400',
  PORT: '4000',
  WORKER_HEALTH_PORT: '4001',
  WEB_ORIGIN: 'http://localhost:3000',
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

  it('fails fast when infrastructure configuration is missing', () => {
    expect(() => validateEnvironment({ ...validEnvironment, REDIS_URL: undefined })).toThrow(
      'REDIS_URL is required',
    );
  });

  it('rejects invalid service URLs and ports', () => {
    expect(() =>
      validateEnvironment({ ...validEnvironment, MINIO_ENDPOINT: 'minio:9000' }),
    ).toThrow('MINIO_ENDPOINT must be a valid HTTP(S) URL');
    expect(() => validateEnvironment({ ...validEnvironment, CLAMAV_PORT: '0' })).toThrow(
      'CLAMAV_PORT must be a positive integer',
    );
  });

  it('parses numeric infrastructure limits', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({
      CLAMAV_PORT: 3310,
      UPLOAD_MAX_BYTES: 26_214_400,
      PORT: 4000,
      WORKER_HEALTH_PORT: 4001,
    });
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
