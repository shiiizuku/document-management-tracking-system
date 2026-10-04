import { isIP } from 'node:net';
import { strongPasswordSchema } from '@dts/contracts';
import { MAX_ATTACHMENT_BYTES } from '../modules/files/media-types.js';

export type CookieSameSite = 'lax' | 'strict' | 'none';

/**
 * Express's `trust proxy` setting, restricted to the two shapes that cannot be talked into
 * trusting the client: a hop count, or the addresses of the proxies themselves. `false` (the
 * default) ignores `X-Forwarded-For` entirely.
 */
export type TrustProxySetting = false | number | string[];

/**
 * The Regional Director's account, as deployment configuration rather than seed data (ADR-0006).
 *
 * Release is gated on a signature record and nobody but a `DIRECTOR` may make one, so the account
 * is a deployment-ordering constraint: a pilot that boots without it registers and routes
 * correspondence perfectly and then stalls at `FOR_SIGNATURE` with no account able to clear it.
 * It used to be seeded as `director@dts.local` with a password written into the repository, which
 * is the worst of both worlds — present enough to hide the constraint, and shared enough that the
 * signatory on the audit trail is not evidence of anything.
 */
export interface DirectorAccountConfig {
  email: string;
  password: string;
}

export interface ValidatedEnvironment {
  DATABASE_URL: string;
  DATABASE_POOL_MAX: number;
  DATABASE_STATEMENT_TIMEOUT_MS: number;
  DATABASE_JIT: boolean;
  REDIS_URL: string;
  MINIO_ENDPOINT: string;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET: string;
  CLAMAV_HOST: string;
  CLAMAV_PORT: number;
  SESSION_SECRET: string;
  COOKIE_SECURE: boolean;
  COOKIE_SAME_SITE: CookieSameSite;
  COOKIE_MAX_AGE_MS: number;
  SESSION_ABSOLUTE_MAX_AGE_MS: number;
  LOGIN_MAX_ATTEMPTS: number;
  LOGIN_LOCKOUT_MS: number;
  UPLOAD_MAX_BYTES: number;
  PORT: number;
  WORKER_HEALTH_PORT: number;
  TRUST_PROXY: TrustProxySetting;
  DIRECTOR_EMAIL?: string;
  DIRECTOR_PASSWORD?: string;
  NODE_ENV?: string;
  WEB_ORIGIN?: string;
}

const requiredString = (environment: Record<string, unknown>, name: string): string => {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} is required`);
  return value.trim();
};

const parseBoolean = (value: unknown, name: string, fallback: boolean): boolean => {
  if (value === undefined || value === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be either true or false`);
};

const parsePositiveInteger = (value: unknown, name: string, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive integer`);
  return parsed;
};

const parseUrl = (
  value: string,
  name: string,
  protocols: string[],
  description: string,
): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid ${description} URL`);
  }
  if (!protocols.includes(parsed.protocol))
    throw new Error(`${name} must be a valid ${description} URL`);
  return value;
};

const TRUST_PROXY_PRESETS = new Set(['loopback', 'linklocal', 'uniquelocal']);

const isAddressOrSubnet = (entry: string): boolean => {
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (family === 0 || rest.length > 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
};

/**
 * Which hops in front of the API may speak for the client through `X-Forwarded-For`
 * (decision 136: the pilot sits behind TLS ingress). Without it every request appears to come
 * from the ingress, so the whole office shares one rate-limit bucket and one login window.
 *
 * Accepted: unset or `false` (ignore the header — local development), a positive hop count
 * (`1` for a single ingress: `req.ip` becomes the address *the ingress* appended, so anything a
 * client put further left is ignored), or a comma-separated list of proxy addresses, CIDR
 * subnets and Express's `loopback` / `linklocal` / `uniquelocal` presets.
 *
 * `true` is refused: it trusts every hop, which makes the left-most `X-Forwarded-For` entry —
 * whatever the client typed — the address the API rate-limits and audits.
 */
export const parseTrustProxy = (value: unknown): TrustProxySetting => {
  if (value === undefined || value === '' || value === 'false' || value === false) return false;
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error('TRUST_PROXY must be a hop count or a list of proxy addresses');
  if (typeof value === 'number' || /^\d+$/.test(value.trim())) {
    const hops = Number(value);
    if (!Number.isSafeInteger(hops) || hops <= 0)
      throw new Error('TRUST_PROXY hop count must be a positive integer; use false to disable');
    return hops;
  }
  if (value.trim() === 'true')
    throw new Error(
      'TRUST_PROXY=true would trust a client-supplied X-Forwarded-For; set a hop count or the ' +
        'proxy addresses instead',
    );
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  for (const entry of entries)
    if (!TRUST_PROXY_PRESETS.has(entry) && !isAddressOrSubnet(entry))
      throw new Error(
        `TRUST_PROXY entry "${entry}" is not an IP address, CIDR subnet, or one of ` +
          'loopback, linklocal, uniquelocal',
      );
  return entries.length === 0 ? false : entries;
};

/**
 * Resolves the configured Director account, or `null` when there is none to configure.
 *
 * Exported on its own because the seed needs exactly this rule and nothing else in
 * {@link validateEnvironment}: the seed runs in the migrator image, which is given a
 * `DATABASE_URL` and little more, so making it validate the whole environment would turn an
 * absent `REDIS_URL` into a failure to seed.
 *
 * Three outcomes, and the one that matters is the middle one:
 *
 * - **Both set** — that account is created, in any environment.
 * - **Neither set, in production** — a hard failure at boot *and* at seed time. This is the point
 *   of the exercise. A production deployment that forgot the Director must be told so loudly,
 *   rather than be handed a development password that works.
 * - **Neither set, outside production** — `null`, and the seed plants `director@dts.local` with
 *   the shared development password so a developer's first `db:seed` yields a working signatory.
 *
 * A half-configured pair is always an error: silently falling back to the development account
 * because only the password was supplied is how a deployment ends up signing as a default.
 */
export const validateDirectorAccount = (
  environment: Record<string, unknown>,
): DirectorAccountConfig | null => {
  const rawEmail = typeof environment.DIRECTOR_EMAIL === 'string' ? environment.DIRECTOR_EMAIL : '';
  const rawPassword =
    typeof environment.DIRECTOR_PASSWORD === 'string' ? environment.DIRECTOR_PASSWORD : '';
  const email = rawEmail.trim();
  const password = rawPassword;

  if (email === '' && password === '') {
    if (environment.NODE_ENV === 'production')
      throw new Error(
        'DIRECTOR_EMAIL and DIRECTOR_PASSWORD are required in production: no outgoing document ' +
          'can be released without a Regional Director account (ADR-0006)',
      );
    return null;
  }
  if (email === '') throw new Error('DIRECTOR_EMAIL is required when DIRECTOR_PASSWORD is set');
  if (password === '') throw new Error('DIRECTOR_PASSWORD is required when DIRECTOR_EMAIL is set');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error('DIRECTOR_EMAIL must be a valid email address');

  // The same strength rule every other password in the system is held to, rather than a looser
  // one for the account with the most authority.
  const strength = strongPasswordSchema.safeParse(password);
  if (!strength.success)
    throw new Error(
      `DIRECTOR_PASSWORD is not strong enough: ${strength.error.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );

  return { email: email.toLowerCase(), password };
};

export const validateEnvironment = (
  environment: Record<string, unknown>,
): Record<string, unknown> & ValidatedEnvironment => {
  const databaseUrl = requiredString(environment, 'DATABASE_URL');
  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (parsedDatabaseUrl.protocol !== 'postgresql:' && parsedDatabaseUrl.protocol !== 'postgres:')
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol');

  const redisUrl = parseUrl(
    requiredString(environment, 'REDIS_URL'),
    'REDIS_URL',
    ['redis:', 'rediss:'],
    'Redis',
  );
  const minioEndpoint = parseUrl(
    requiredString(environment, 'MINIO_ENDPOINT'),
    'MINIO_ENDPOINT',
    ['http:', 'https:'],
    'HTTP(S)',
  );
  const minioAccessKey = requiredString(environment, 'MINIO_ACCESS_KEY');
  const minioSecretKey = requiredString(environment, 'MINIO_SECRET_KEY');
  const minioBucket = requiredString(environment, 'MINIO_BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(minioBucket))
    throw new Error('MINIO_BUCKET must be a valid S3 bucket name');
  const clamavHost = requiredString(environment, 'CLAMAV_HOST');
  const clamavPort = parsePositiveInteger(environment.CLAMAV_PORT, 'CLAMAV_PORT', 3310);

  const sessionSecret = requiredString(environment, 'SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');

  const nodeEnvironment =
    typeof environment.NODE_ENV === 'string' ? environment.NODE_ENV : undefined;
  const cookieSecure = parseBoolean(
    environment.COOKIE_SECURE,
    'COOKIE_SECURE',
    nodeEnvironment === 'production',
  );
  if (nodeEnvironment === 'production' && !cookieSecure)
    throw new Error('COOKIE_SECURE must be true in production');
  const rawSameSite = environment.COOKIE_SAME_SITE ?? 'lax';
  if (rawSameSite !== 'lax' && rawSameSite !== 'strict' && rawSameSite !== 'none')
    throw new Error('COOKIE_SAME_SITE must be one of lax, strict, or none');
  if (rawSameSite === 'none' && !cookieSecure)
    throw new Error('COOKIE_SECURE must be true when COOKIE_SAME_SITE is none');

  const cookieMaxAgeMs = parsePositiveInteger(
    environment.COOKIE_MAX_AGE_MS,
    'COOKIE_MAX_AGE_MS',
    30 * 60 * 1000,
  );
  if (cookieMaxAgeMs % 1000 !== 0) throw new Error('COOKIE_MAX_AGE_MS must be a multiple of 1000');

  // `COOKIE_MAX_AGE_MS` is the *inactivity* window and is renewed on every authenticated
  // request (policy register P-10). This is the ceiling that renewal cannot push past, so a
  // browser left open on a shared desk eventually has to authenticate again. It must exceed
  // the inactivity window, otherwise a session would expire before it could ever be renewed.
  const sessionAbsoluteMaxAgeMs = parsePositiveInteger(
    environment.SESSION_ABSOLUTE_MAX_AGE_MS,
    'SESSION_ABSOLUTE_MAX_AGE_MS',
    8 * 60 * 60 * 1000,
  );
  if (sessionAbsoluteMaxAgeMs % 1000 !== 0)
    throw new Error('SESSION_ABSOLUTE_MAX_AGE_MS must be a multiple of 1000');
  if (sessionAbsoluteMaxAgeMs < cookieMaxAgeMs)
    throw new Error(
      'SESSION_ABSOLUTE_MAX_AGE_MS must be greater than or equal to COOKIE_MAX_AGE_MS',
    );

  const loginMaxAttempts = parsePositiveInteger(
    environment.LOGIN_MAX_ATTEMPTS,
    'LOGIN_MAX_ATTEMPTS',
    5,
  );
  const loginLockoutMs = parsePositiveInteger(
    environment.LOGIN_LOCKOUT_MS,
    'LOGIN_LOCKOUT_MS',
    15 * 60 * 1000,
  );

  // UPLOAD_MAX_BYTES is what the upload use case enforces. MAX_ATTACHMENT_BYTES is the compiled
  // ceiling the multipart parser is wired with — a decorator argument, so it cannot be raised from
  // the environment. Configuration may therefore only narrow the limit, and asking for more than
  // the parser will ever accept is a misconfiguration rather than a silently capped value.
  const uploadMaxBytes = parsePositiveInteger(
    environment.UPLOAD_MAX_BYTES,
    'UPLOAD_MAX_BYTES',
    MAX_ATTACHMENT_BYTES,
  );
  if (uploadMaxBytes > MAX_ATTACHMENT_BYTES)
    throw new Error(`UPLOAD_MAX_BYTES must not exceed ${MAX_ATTACHMENT_BYTES}`);
  const port = parsePositiveInteger(environment.PORT, 'PORT', 4000);
  const workerHealthPort = parsePositiveInteger(
    environment.WORKER_HEALTH_PORT,
    'WORKER_HEALTH_PORT',
    4001,
  );
  // Size the pool to the database host's cores, not up: Postgres is the CPU-bound side (D2), so
  // extra connections only move the queue from the API into Postgres. The statement timeout
  // keeps one runaway scan from holding a connection; past it the request is answered 503.
  const databasePoolMax = parsePositiveInteger(
    environment.DATABASE_POOL_MAX,
    'DATABASE_POOL_MAX',
    10,
  );
  const databaseStatementTimeoutMs = parsePositiveInteger(
    environment.DATABASE_STATEMENT_TIMEOUT_MS,
    'DATABASE_STATEMENT_TIMEOUT_MS',
    10_000,
  );
  // Off by default: the API's queries are short, and for them compiling costs more than it saves.
  const databaseJit = parseBoolean(environment.DATABASE_JIT, 'DATABASE_JIT', false);
  const trustProxy = parseTrustProxy(environment.TRUST_PROXY);
  // Called for its refusal, not its value: the API itself never creates the account, but it is
  // the process a deployment starts first, so it is where a missing Director must be reported.
  validateDirectorAccount(environment);

  if (typeof environment.WEB_ORIGIN === 'string') {
    for (const origin of environment.WEB_ORIGIN.split(','))
      parseUrl(origin.trim(), 'WEB_ORIGIN', ['http:', 'https:'], 'HTTP(S)');
  }

  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    DATABASE_POOL_MAX: databasePoolMax,
    DATABASE_STATEMENT_TIMEOUT_MS: databaseStatementTimeoutMs,
    DATABASE_JIT: databaseJit,
    REDIS_URL: redisUrl,
    MINIO_ENDPOINT: minioEndpoint,
    MINIO_ACCESS_KEY: minioAccessKey,
    MINIO_SECRET_KEY: minioSecretKey,
    MINIO_BUCKET: minioBucket,
    CLAMAV_HOST: clamavHost,
    CLAMAV_PORT: clamavPort,
    SESSION_SECRET: sessionSecret,
    COOKIE_SECURE: cookieSecure,
    COOKIE_SAME_SITE: rawSameSite,
    COOKIE_MAX_AGE_MS: cookieMaxAgeMs,
    SESSION_ABSOLUTE_MAX_AGE_MS: sessionAbsoluteMaxAgeMs,
    LOGIN_MAX_ATTEMPTS: loginMaxAttempts,
    LOGIN_LOCKOUT_MS: loginLockoutMs,
    UPLOAD_MAX_BYTES: uploadMaxBytes,
    PORT: port,
    WORKER_HEALTH_PORT: workerHealthPort,
    TRUST_PROXY: trustProxy,
  };
};
