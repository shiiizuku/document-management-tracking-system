import { dirname, resolve } from 'node:path';
import { test, type FullConfig } from '@playwright/test';
import type { SignedInRole } from './accounts';

/**
 * Where things are on disk, derived from the one anchor Playwright gives that means what it says.
 *
 * Neither of the obvious options works here. `import.meta.url` is gone once Playwright has
 * transpiled these files to CommonJS, and `process.cwd()` depends on where the command was typed.
 * `FullConfig.rootDir` looks right and is not: it is the common base of the configured test
 * directories, so with `testDir: './tests'` it is `apps/e2e/tests`, which quietly shifts every
 * relative path by one level. `configFile` is the absolute path of `playwright.config.ts`, which is
 * exactly the thing worth resolving from.
 */
type ConfigPaths = Pick<FullConfig, 'configFile' | 'rootDir'>;

/** `apps/e2e`. */
export const packageRoot = (config: ConfigPaths): string =>
  config.configFile === undefined || config.configFile === ''
    ? // Only reachable when the suite is run with no config file at all, where `rootDir` is the
      // only anchor there is.
      config.rootDir
    : dirname(config.configFile);

/** The repository root, for the build artefacts and for running npm scripts in other workspaces. */
export const repositoryRoot = (config: ConfigPaths): string =>
  resolve(packageRoot(config), '..', '..');

/**
 * Where a saved session lives: `apps/e2e/.auth/<role>.json`, written once by `auth.setup.ts` and
 * read by every spec through the `actingAs` fixture.
 *
 * A function rather than a constant because `test.info()` is only meaningful inside a test, a hook
 * or a fixture — which is the only place this is called from.
 */
export const storageStatePath = (role: SignedInRole): string =>
  resolve(packageRoot(test.info().config), '.auth', `${role}.json`);
