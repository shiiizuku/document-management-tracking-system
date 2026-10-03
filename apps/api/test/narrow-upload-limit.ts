/**
 * Narrows `UPLOAD_MAX_BYTES` for the suite that tests the upload size limit.
 *
 * A side-effect module rather than a line in `beforeAll`, because `ConfigModule.forRoot()` reads
 * and validates the environment when `app.module.ts` is *imported*, and `ConfigService` answers
 * from that validated snapshot in preference to live `process.env`. Setting the variable inside a
 * hook is therefore too late — it has to happen before the app module's import is evaluated, which
 * is what importing this file above it achieves (ES module imports run in source order).
 */
export const CONFIGURED_MAX_BYTES = 4 * 1024;

export const UPLOAD_MAX_BYTES_BEFORE = process.env.UPLOAD_MAX_BYTES;

process.env.UPLOAD_MAX_BYTES = String(CONFIGURED_MAX_BYTES);
