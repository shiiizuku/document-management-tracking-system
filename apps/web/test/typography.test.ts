import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The two facts decision 172 is made of, asserted against the source rather than against a render.
 *
 * Neither can be caught by a component test: a stylesheet `@import` is not in anything's DOM, and
 * a `font-serif` left behind does not fail — it quietly falls back to the browser's Times, which
 * reads as a bug on a screen nobody happened to open. Both are one grep, so they are one test.
 */

/*
 * Found by walking up from the working directory, not from `import.meta.url`: these specs run in
 * the jsdom environment, where the module URL is an `http:` one that `fileURLToPath` refuses. The
 * working directory is `apps/web` under `npm test -w @dts/web` and the repository root when vitest
 * is pointed here with `--root`, so neither can be assumed.
 */
const findWebRoot = (): string => {
  let directory = process.cwd();
  for (;;) {
    if (existsSync(join(directory, 'app/theme.css'))) return directory;
    const parent = dirname(directory);
    if (parent === directory) throw new Error('could not locate apps/web from ' + process.cwd());
    directory = parent;
  }
};

const webRoot = existsSync(join(process.cwd(), 'apps/web/app/theme.css'))
  ? join(process.cwd(), 'apps/web')
  : findWebRoot();

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|css|js)$/.test(entry) ? [path] : [];
  });

describe('typography', () => {
  it('asks for no font from a third-party host', () => {
    const theme = readFileSync(join(webRoot, 'app/theme.css'), 'utf8');
    expect(theme).not.toContain('fonts.googleapis.com');
    expect(theme).not.toContain('fonts.gstatic.com');
  });

  it('has retired the display serif everywhere it was named', () => {
    const offenders = [...sourceFiles(join(webRoot, 'app')), ...sourceFiles(join(webRoot, 'src'))]
      .filter((path) => /\bfont-serif\b|--font-serif|DM Serif/.test(readFileSync(path, 'utf8')))
      // The two surviving mentions are comments saying the family is gone on purpose, which is
      // what stops it being re-added; they are matched by name so a third one fails here.
      .filter((path) => !/theme\.css$|tailwind\.config\.js$/.test(path));

    expect(offenders).toEqual([]);
  });
});
