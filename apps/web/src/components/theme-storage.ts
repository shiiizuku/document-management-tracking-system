/*
 * Where the appearance choices live in localStorage, and the one-time migration between them.
 *
 * Two independent choices, under two keys:
 *
 * - `dts.theme` holds the colour MODE (light / dark / system). The name predates the Civic Ledger
 *   themes and is kept, because renaming it would reset every user's dark-mode choice.
 * - `dts.theme.v1` holds the THEME (neutral / sage / blush / civic) — the whole palette.
 *
 * The theme replaced the five accents that were stored under `dts.accent.v1`. Their closest
 * matches carry over (green → sage, rose → blush), everything else lands on the default, and the
 * old key is removed so the migration happens exactly once.
 *
 * This file is shared by `ThemeProvider` and the blocking boot script in `app/layout.tsx`, which is
 * why the boot script is built here as a string from the same constants: the script has to run
 * before React, so it cannot import anything, but it can at least be generated from the values the
 * provider uses rather than retyped beside them.
 */

export const THEMES = ['neutral', 'sage', 'blush', 'civic'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'neutral';

/** Human names, used for the swatches' accessible labels — the picker shows no visible text. */
export const THEME_NAMES: Record<Theme, string> = {
  neutral: 'Neutral pastel',
  sage: 'Sage pastel',
  blush: 'Blush pastel',
  civic: 'Civic Ledger',
};

export const COLOR_MODE_STORAGE_KEY = 'dts.theme';
export const THEME_STORAGE_KEY = 'dts.theme.v1';
/** The retired accent key. Read once, migrated, then deleted. */
export const LEGACY_ACCENT_STORAGE_KEY = 'dts.accent.v1';

const LEGACY_ACCENT_TO_THEME: Readonly<Record<string, Theme>> = { green: 'sage', rose: 'blush' };

export const isTheme = (value: unknown): value is Theme => THEMES.some((theme) => theme === value);

/**
 * The stored theme, migrating a legacy accent if that is all there is.
 *
 * A stored `dts.theme.v1` always wins, even over a leftover accent key: the accent can only be
 * newer than the theme if something wrote the retired key after the migration, and nothing does.
 * The leftover is still removed, so the old key cannot linger forever on a device that somehow has
 * both.
 */
export function readStoredTheme(storage: Storage): Theme {
  const stored = storage.getItem(THEME_STORAGE_KEY);
  const legacy = storage.getItem(LEGACY_ACCENT_STORAGE_KEY);
  if (legacy !== null) storage.removeItem(LEGACY_ACCENT_STORAGE_KEY);
  if (isTheme(stored)) return stored;
  if (legacy === null) return DEFAULT_THEME;

  // Object.hasOwn, so a stored 'constructor' or 'toString' is just another unknown accent.
  const migrated = Object.hasOwn(LEGACY_ACCENT_TO_THEME, legacy)
    ? (LEGACY_ACCENT_TO_THEME[legacy] ?? DEFAULT_THEME)
    : DEFAULT_THEME;
  storage.setItem(THEME_STORAGE_KEY, migrated);
  return migrated;
}

/*
 * The boot script: the same reading as above, plus the colour mode, written as ES5 because it runs
 * unbundled. It sets `data-theme` and `.dark` on <html> before first paint, theme first, so a
 * browser without `matchMedia` loses only the system dark-mode guess and not the palette. Any
 * storage failure — a private window that refuses localStorage — falls back to the default theme
 * rather than to no theme, since the bare `:root` palette is only a safety net.
 */
export const themeBootScript = `(function(){var root=document.documentElement;try{var s=localStorage;var themes=${JSON.stringify(THEMES)};var th=s.getItem('${THEME_STORAGE_KEY}');var a=s.getItem('${LEGACY_ACCENT_STORAGE_KEY}');if(a!==null){s.removeItem('${LEGACY_ACCENT_STORAGE_KEY}');}if(themes.indexOf(th)<0){var map=${JSON.stringify(LEGACY_ACCENT_TO_THEME)};th=(a!==null&&Object.prototype.hasOwnProperty.call(map,a)&&map[a])||'${DEFAULT_THEME}';if(a!==null){s.setItem('${THEME_STORAGE_KEY}',th);}}root.dataset.theme=th;var t=s.getItem('${COLOR_MODE_STORAGE_KEY}');if(!t){var old=JSON.parse(s.getItem('dts.appearance')||'null');t=old&&old.mode;}var dark=t==='dark'||(t!=='light'&&!!window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches);root.classList.toggle('dark',dark);}catch(e){if(!root.dataset.theme){root.dataset.theme='${DEFAULT_THEME}';}}})();`;
