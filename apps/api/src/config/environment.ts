export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface ValidatedEnvironment {
  DATABASE_URL: string;
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
    throw new Error('SESSION_ABSOLUTE_MAX_AGE_MS must be greater than or equal to COOKIE_MAX_AGE_MS');

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

  const uploadMaxBytes = parsePositiveInteger(
    environment.UPLOAD_MAX_BYTES,
    'UPLOAD_MAX_BYTES',
    25 * 1024 * 1024,
  );
  const port = parsePositiveInteger(environment.PORT, 'PORT', 4000);
  const workerHealthPort = parsePositiveInteger(
    environment.WORKER_HEALTH_PORT,
    'WORKER_HEALTH_PORT',
    4001,
  );
  if (typeof environment.WEB_ORIGIN === 'string') {
    for (const origin of environment.WEB_ORIGIN.split(','))
      parseUrl(origin.trim(), 'WEB_ORIGIN', ['http:', 'https:'], 'HTTP(S)');
  }

  return {
    ...environment,
    DATABASE_URL: databaseUrl,
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
  };
};
