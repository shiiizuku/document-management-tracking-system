import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/components/theme-storage';

/*
 * The palettes, checked against the stylesheet rather than a render: jsdom does not resolve CSS
 * variables, and the failure this guards against — a theme added to `THEMES` with no dark block,
 * so dark mode silently shows the light palette's primary — is invisible in any DOM.
 *
 * The contrast check reads the oklch values straight out of `theme.css` and converts them back to
 * sRGB, so it checks what ships, not the hex in the handoff it was converted from.
 */

const findWebRoot = (): string => {
  let directory = process.cwd();
  for (;;) {
    if (existsSync(join(directory, 'app/theme.css'))) return directory;
    if (existsSync(join(directory, 'apps/web/app/theme.css'))) return join(directory, 'apps/web');
    const parent = dirname(directory);
    if (parent === directory) throw new Error('could not locate apps/web from ' + process.cwd());
    directory = parent;
  }
};

const css = readFileSync(join(findWebRoot(), 'app/theme.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every top-level rule as [selector list, declarations]. */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
  // Everything up to the last `;` before the brace is a preceding at-rule (`@import`), not selector.
  selectors: (match[1] ?? '')
    .slice((match[1] ?? '').lastIndexOf(';') + 1)
    .split(',')
    .map((selector) => selector.trim()),
  declarations: Object.fromEntries(
    [...(match[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((d) => [d[1], d[2]?.trim()]),
  ) as Record<string, string>,
}));

const block = (selector: string) => rules.find((rule) => rule.selectors.includes(selector));

/** The variables in force for one theme and mode, in cascade order. */
const palette = (theme: string, dark: boolean): Record<string, string> => ({
  ...block(':root')?.declarations,
  ...block(`:root[data-theme='${theme}']`)?.declarations,
  ...(dark ? block(':root.dark')?.declarations : {}),
  ...(dark ? block(`:root.dark[data-theme='${theme}']`)?.declarations : {}),
});

/** oklch(L C H) → relative luminance, via OKLab and linear sRGB (clamped to gamut). */
const luminance = (value: string): number => {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
  if (!match) throw new Error(`not an oklch() colour: ${value}`);
  const [L, C, H] = [Number(match[1]), Number(match[2]), (Number(match[3]) * Math.PI) / 180];
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (x: number) => Math.min(1, Math.max(0, x));
  const r = clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
};

const contrast = (one: string, two: string) => {
  const [hi, lo] = [luminance(one), luminance(two)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const COMBINATIONS = THEMES.flatMap((theme) => [
  [theme, 'light'] as const,
  [theme, 'dark'] as const,
]);

/**
 * [text or indicator, what it sits on, minimum ratio]. 4.5:1 for text (WCAG 1.4.3); 3:1 for field
 * borders, the focus ring and the active-nav underline, which identify a control or its state
 * (WCAG 1.4.11). Each pair is one the screens actually draw — primary is link and button colour on
 * the page, a card, a muted fill (the open Advanced search button) and a hovered row.
 */
const PAIRS = [
  ['--foreground', '--background', 4.5],
  ['--foreground', '--card', 4.5],
  ['--foreground', '--muted', 4.5],
  ['--muted-foreground', '--background', 4.5],
  ['--muted-foreground', '--card', 4.5],
  ['--muted-foreground', '--muted', 4.5],
  ['--foreground-secondary', '--background', 4.5],
  ['--foreground-secondary', '--muted', 4.5],
  ['--primary', '--background', 4.5],
  ['--primary', '--card', 4.5],
  ['--primary', '--muted', 4.5],
  ['--primary', '--accent', 4.5],
  ['--primary-foreground', '--primary', 4.5],
  ['--primary-foreground', '--primary-hover', 4.5],
  ['--seal-foreground', '--background', 4.5],
  ['--seal-foreground', '--seal-tint', 4.5],
  ['--sidebar-foreground', '--sidebar', 4.5],
  ['--sidebar-foreground', '--sidebar-accent', 4.5],
  ['--sidebar-muted-foreground', '--sidebar', 4.5],
  ['--sidebar-seal', '--sidebar', 4.5],
  ['--move-action-foreground', '--move-action', 4.5],
  ['--input', '--card', 3],
  ['--input', '--background', 3],
  ['--ring', '--background', 3],
  ['--sidebar-primary', '--sidebar', 3],
] as const;

describe('theme palettes', () => {
  it.each(THEMES)('defines %s in both light and dark', (theme) => {
    expect(block(`:root[data-theme='${theme}']`)).toBeDefined();
    expect(block(`:root.dark[data-theme='${theme}']`)).toBeDefined();
  });

  it.each(COMBINATIONS)(
    '%s %s meets 4.5:1 for text and 3:1 for borders and focus indicators',
    (theme, mode) => {
      const vars = palette(theme, mode === 'dark');
      const failures = PAIRS.flatMap(([text, ground, minimum]) => {
        const ratio = contrast(vars[text] ?? '', vars[ground] ?? '');
        return ratio >= minimum
          ? []
          : [`${text} on ${ground} is ${ratio.toFixed(2)}:1, needs ${minimum}:1`];
      });
      expect(failures, `${theme} ${mode}`).toEqual([]);
    },
  );
});
