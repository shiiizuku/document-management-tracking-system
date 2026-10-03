import { describe, expect, it } from 'vitest';
import { validateDirectorAccount, validateEnvironment } from '../src/config/environment.js';

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

/*
 * ADR-0006 makes the Regional Director's account a deployment-ordering constraint: release is
 * gated on a signature record and nobody else may make one, so a pilot that boots without the
 * account registers and routes correspondence perfectly and then stalls at `FOR_SIGNATURE`.
 *
 * It used to be seed data with a password in the repository, which hid the constraint. These are
 * the cases that make it visible instead.
 */
describe('Director account configuration', () => {
  const production = { ...validEnvironment, NODE_ENV: 'production', COOKIE_SECURE: 'true' };

  it('refuses a production boot with no Director configured', () => {
    expect(() => validateEnvironment(production)).toThrow(
      /DIRECTOR_EMAIL and DIRECTOR_PASSWORD are required in production/,
    );
  });

  it('accepts a production boot once the Director is configured', () => {
    expect(() =>
      validateEnvironment({
        ...production,
        DIRECTOR_EMAIL: 'director@mgb.example.gov.ph',
        DIRECTOR_PASSWORD: 'Regional-Director-2026!',
      }),
    ).not.toThrow();
  });

  /*
   * Outside production the development account is still planted, because a developer's first
   * `db:seed` has to yield a signatory. That fallback is the thing production may not reach.
   */
  it('leaves the development seed to its default outside production', () => {
    expect(validateDirectorAccount(validEnvironment)).toBeNull();
  });

  it('normalizes a configured address and keeps the password verbatim', () => {
    expect(
      validateDirectorAccount({
        ...validEnvironment,
        DIRECTOR_EMAIL: '  Director@MGB.example.gov.ph ',
        DIRECTOR_PASSWORD: 'Regional-Director-2026!',
      }),
    ).toEqual({ email: 'director@mgb.example.gov.ph', password: 'Regional-Director-2026!' });
  });

  // A half-configured pair is an error rather than a silent fallback: falling back to the
  // development account because only the password was supplied is how a deployment ends up
  // signing as a default.
  it('refuses a half-configured pair', () => {
    expect(() =>
      validateDirectorAccount({
        ...validEnvironment,
        DIRECTOR_PASSWORD: 'Regional-Director-2026!',
      }),
    ).toThrow('DIRECTOR_EMAIL is required when DIRECTOR_PASSWORD is set');
    expect(() =>
      validateDirectorAccount({ ...validEnvironment, DIRECTOR_EMAIL: 'director@example.gov.ph' }),
    ).toThrow('DIRECTOR_PASSWORD is required when DIRECTOR_EMAIL is set');
  });

  // Held to the same strength rule as every other password, rather than a looser one for the
  // account with the most authority.
  it('refuses a weak Director password', () => {
    expect(() =>
      validateDirectorAccount({
        ...validEnvironment,
        DIRECTOR_EMAIL: 'director@example.gov.ph',
        DIRECTOR_PASSWORD: 'director',
      }),
    ).toThrow(/DIRECTOR_PASSWORD is not strong enough/);
  });

  it('refuses an address that is not one', () => {
    expect(() =>
      validateDirectorAccount({
        ...validEnvironment,
        DIRECTOR_EMAIL: 'director',
        DIRECTOR_PASSWORD: 'Regional-Director-2026!',
      }),
    ).toThrow('DIRECTOR_EMAIL must be a valid email address');
  });
});
