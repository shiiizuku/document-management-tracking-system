process.env.DATABASE_URL ??= 'postgresql://dts:dts@localhost:5432/dts_test';
process.env.SESSION_SECRET ??= 'test-session-secret-that-is-at-least-32-characters';
process.env.COOKIE_SECURE ??= 'false';
process.env.COOKIE_SAME_SITE ??= 'lax';
process.env.COOKIE_MAX_AGE_MS ??= '1800000';
