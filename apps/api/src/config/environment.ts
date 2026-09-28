export type CookieSameSite = 'lax' | 'strict' | 'none';

export interface ValidatedEnvironment {
  DATABASE_URL: string;
  SESSION_SECRET: string;
  COOKIE_SECURE: boolean;
  COOKIE_SAME_SITE: CookieSameSite;
  COOKIE_MAX_AGE_MS: number;
  NODE_ENV?: string;
  PORT?: string;
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

  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    SESSION_SECRET: sessionSecret,
    COOKIE_SECURE: cookieSecure,
    COOKIE_SAME_SITE: rawSameSite,
    COOKIE_MAX_AGE_MS: cookieMaxAgeMs,
  };
};
