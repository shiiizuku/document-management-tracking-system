/**
 * Starts the web app's standalone server the way `apps/web/Dockerfile` lays it out.
 *
 * `next build` leaves `.next/static` and `public/` out of `.next/standalone` on purpose — they are
 * meant for a CDN or to be copied in — and the Dockerfile copies them. Without the copy every chunk
 * request is a 404, no page hydrates, and every spec fails on a form that was rendered but never
 * wired.
 *
 * It has to happen **before** the server starts: the standalone server indexes its static files at
 * boot, so files copied in afterwards (from `global-setup.ts`, say, which Playwright runs after
 * `webServer`) still 404.
 *
 * The server is imported rather than spawned so the process Playwright started is the process it
 * stops — the same reason `playwright.config.ts` invokes `node` directly rather than through npm.
 * `server.js` is CommonJS, which a dynamic `import()` loads as-is.
 */
import { cpSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const standalone = resolve(web, '.next', 'standalone', 'apps', 'web');

cpSync(resolve(web, '.next', 'static'), resolve(standalone, '.next', 'static'), {
  recursive: true,
});
if (existsSync(resolve(web, 'public')))
  cpSync(resolve(web, 'public'), resolve(standalone, 'public'), { recursive: true });

await import(pathToFileURL(resolve(standalone, 'server.js')).href);
