// Integration tests that boot AppModule need the full app configuration present before the
// module is constructed (it validates the environment on creation). DATABASE_URL and
// ALLOW_DATABASE_RESET are supplied by the CI job / local command; everything else gets a
// test default here. Runs as a vitest setup file, before any test module is imported.
process.env.SESSION_SECRET ??= 'integration-session-secret-at-least-32-characters';
process.env.COOKIE_SECURE ??= 'false';
process.env.COOKIE_SAME_SITE ??= 'lax';
process.env.COOKIE_MAX_AGE_MS ??= '1800000';
process.env.SESSION_ABSOLUTE_MAX_AGE_MS ??= '28800000';
process.env.LOGIN_MAX_ATTEMPTS ??= '5';
process.env.LOGIN_LOCKOUT_MS ??= '900000';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.MINIO_ENDPOINT ??= 'http://localhost:9000';
process.env.MINIO_ACCESS_KEY ??= 'dts-local';
process.env.MINIO_SECRET_KEY ??= 'test-minio-secret';
process.env.MINIO_BUCKET ??= 'dts-files';
process.env.CLAMAV_HOST ??= 'localhost';
process.env.CLAMAV_PORT ??= '3310';
process.env.UPLOAD_MAX_BYTES ??= '26214400';
process.env.PORT ??= '4100';
process.env.WORKER_HEALTH_PORT ??= '4101';
process.env.WEB_ORIGIN ??= 'http://localhost:3000';
