import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEB_ORIGIN,
  PUBLIC_SESSION_SECRETS,
  parseTrustProxy,
  parseWebOrigins,
  seedsDemoAccounts,
  validateDirectorAccount,
  validateEnvironment,
  validateSeedAdminPassword,
} from '../src/config/environment.js';

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
  it('ignores X-Forwarded-For unless a proxy is configured', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({ TRUST_PROXY: false });
    expect(parseTrustProxy('false')).toBe(false);
  });

  it('accepts a hop count or proxy addresses for TRUST_PROXY', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, 10.0.0.0/8, fd00::/8, 172.18.0.2')).toEqual([
      'loopback',
      '10.0.0.0/8',
      'fd00::/8',
      '172.18.0.2',
    ]);
  });

  it('refuses a TRUST_PROXY that would trust the client', () => {
    expect(() => parseTrustProxy('true')).toThrow('would trust a client-supplied X-Forwarded-For');
    expect(() => parseTrustProxy('0')).toThrow('TRUST_PROXY hop count must be a positive integer');
    expect(() => parseTrustProxy('ingress.local')).toThrow('TRUST_PROXY entry "ingress.local"');
    expect(() => parseTrustProxy('10.0.0.0/33')).toThrow('TRUST_PROXY entry "10.0.0.0/33"');
  });

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

  // R-21: both strings are published in this repository, so anyone who has read it can sign a
  // session for any user. The compose fallback and the `.env.example` placeholder are both 32+
  // characters, so the length rule alone let them through.
  it.each(PUBLIC_SESSION_SECRETS)(
    'refuses the published session secret %s outside tests',
    (secret) => {
      for (const NODE_ENV of ['development', 'production', undefined])
        expect(() =>
          validateEnvironment({
            ...validEnvironment,
            NODE_ENV,
            COOKIE_SECURE: NODE_ENV === 'production' ? 'true' : 'false',
            WEB_ORIGIN:
              NODE_ENV === 'production' ? 'https://dts.example.gov.ph' : 'http://localhost:3000',
            DIRECTOR_EMAIL: 'director@example.gov.ph',
            DIRECTOR_PASSWORD: 'Regional-Director-2026!',
            SESSION_SECRET: secret,
          }),
        ).toThrow('SESSION_SECRET is published in this repository');
    },
  );

  it('lets the test suites run on a published session secret', () => {
    for (const secret of PUBLIC_SESSION_SECRETS)
      expect(validateEnvironment({ ...validEnvironment, SESSION_SECRET: secret })).toMatchObject({
        SESSION_SECRET: secret,
      });
  });

  it('names every fallback the repository ships for SESSION_SECRET', () => {
    const shipped = [
      ...readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8').matchAll(
        /SESSION_SECRET: \$\{SESSION_SECRET:-([^}]+)\}/g,
      ),
      ...readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8').matchAll(
        /^SESSION_SECRET=(.+)$/gm,
      ),
    ].map((match) => match[1]!.trim());
    expect(shipped.length).toBeGreaterThan(0);
    for (const secret of shipped) expect(PUBLIC_SESSION_SECRETS).toContain(secret);
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
  const production = {
    ...validEnvironment,
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    WEB_ORIGIN: 'https://dts.mgb.example.gov.ph',
  };

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

/*
 * The first administrator's password. The development fallback is printed in the README, so a
 * production seed that forgot the variable would publish the most privileged account's password.
 */
describe('Seed administrator password', () => {
  it('refuses to seed in production without one', () => {
    expect(() => validateSeedAdminPassword({ NODE_ENV: 'production' })).toThrow(
      /SEED_ADMIN_PASSWORD is required in production/,
    );
    // Compose passes an unset variable through as an empty string.
    expect(() =>
      validateSeedAdminPassword({ NODE_ENV: 'production', SEED_ADMIN_PASSWORD: '' }),
    ).toThrow(/SEED_ADMIN_PASSWORD is required in production/);
  });

  it('leaves the development seed to its default outside production', () => {
    expect(validateSeedAdminPassword({ NODE_ENV: 'development' })).toBeNull();
    expect(validateSeedAdminPassword({ NODE_ENV: 'test', SEED_ADMIN_PASSWORD: '' })).toBeNull();
  });

  it('returns a configured password verbatim', () => {
    expect(
      validateSeedAdminPassword({
        NODE_ENV: 'production',
        SEED_ADMIN_PASSWORD: 'First-Administrator-2026!',
      }),
    ).toBe('First-Administrator-2026!');
  });

  it('refuses a weak password in any environment', () => {
    expect(() =>
      validateSeedAdminPassword({ NODE_ENV: 'development', SEED_ADMIN_PASSWORD: 'admin' }),
    ).toThrow(/SEED_ADMIN_PASSWORD is not strong enough/);
  });

  // The API never reads it, so its boot must not demand it.
  it('is not required at API boot', () => {
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        WEB_ORIGIN: 'https://dts.mgb.example.gov.ph',
        DIRECTOR_EMAIL: 'director@mgb.example.gov.ph',
        DIRECTOR_PASSWORD: 'Regional-Director-2026!',
      }),
    ).not.toThrow();
  });
});

/*
 * The CORS allowlist and the OpenAPI switch (D6, Phase 7). The HTTP behaviour these produce is
 * asserted end to end in http-edge.test.ts; this covers what configuration is refused.
 */
describe('WEB_ORIGIN', () => {
  it('parses a comma-separated list and trims it', () => {
    expect(parseWebOrigins(' https://dts.example , https://records.dts.example ')).toEqual([
      'https://dts.example',
      'https://records.dts.example',
    ]);
  });

  it('falls back to the local web port when unset, which no deployment is served from', () => {
    expect(parseWebOrigins(undefined)).toEqual([DEFAULT_WEB_ORIGIN]);
    expect(parseWebOrigins('')).toEqual([DEFAULT_WEB_ORIGIN]);
  });

  it('refuses a wildcard, a path, or a trailing slash, none of which a browser Origin matches', () => {
    expect(() => parseWebOrigins('*')).toThrow('must be an HTTP(S) origin');
    expect(() => parseWebOrigins('https://dts.example/app')).toThrow('must be a bare origin');
    expect(() => parseWebOrigins('https://dts.example/')).toThrow('must be a bare origin');
    expect(() => parseWebOrigins('ftp://dts.example')).toThrow('must be an HTTP(S) origin');
  });

  it('requires HTTPS in production, where the session cookie is Secure', () => {
    expect(() => parseWebOrigins('http://dts.example', true)).toThrow(
      'must be HTTPS in production',
    );
    expect(parseWebOrigins('https://dts.example', true)).toEqual(['https://dts.example']);
    expect(() =>
      validateEnvironment({
        ...validEnvironment,
        NODE_ENV: 'production',
        COOKIE_SECURE: 'true',
        WEB_ORIGIN: 'http://dts.example',
        DIRECTOR_EMAIL: 'director@mgb.example.gov.ph',
        DIRECTOR_PASSWORD: 'Regional-Director-2026!',
      }),
    ).toThrow('must be HTTPS in production');
  });
});

describe('API_DOCS', () => {
  const production = {
    ...validEnvironment,
    NODE_ENV: 'production',
    COOKIE_SECURE: 'true',
    WEB_ORIGIN: 'https://dts.example',
    DIRECTOR_EMAIL: 'director@mgb.example.gov.ph',
    DIRECTOR_PASSWORD: 'Regional-Director-2026!',
  };

  it('serves the OpenAPI UI outside production by default', () => {
    expect(validateEnvironment(validEnvironment)).toMatchObject({ API_DOCS: true });
  });

  it('hides it in production unless asked for', () => {
    expect(validateEnvironment(production)).toMatchObject({ API_DOCS: false });
    expect(validateEnvironment({ ...production, API_DOCS: 'true' })).toMatchObject({
      API_DOCS: true,
    });
  });
});

describe('seedsDemoAccounts', () => {
  it('seeds the development accounts everywhere except production', () => {
    expect(seedsDemoAccounts({ NODE_ENV: 'production' })).toBe(false);
    expect(seedsDemoAccounts({ NODE_ENV: 'development' })).toBe(true);
    expect(seedsDemoAccounts({})).toBe(true);
  });
});
