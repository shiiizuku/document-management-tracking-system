'use client';

import * as React from 'react';
import {
  COLOR_MODE_STORAGE_KEY,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  readStoredTheme,
  type Theme,
} from './theme-storage';

export { THEMES, THEME_NAMES, THEME_STORAGE_KEY, type Theme } from './theme-storage';

type ColorMode = 'light' | 'dark' | 'system';
type ThemeContext = {
  /** Light, dark, or following the system. Independent of the theme. */
  colorMode: ColorMode;
  resolvedColorMode: 'light' | 'dark';
  setColorMode: (mode: ColorMode) => void;
  /** The active Civic Ledger palette, independent of light or dark mode. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
};
const ThemeContext = React.createContext<ThemeContext | null>(null);

function storedColorMode(): ColorMode {
  try {
    const value = window.localStorage.getItem(COLOR_MODE_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
    // Keep the user's mode when upgrading from the older appearance preference.
    const previous = JSON.parse(window.localStorage.getItem('dts.appearance') ?? 'null') as {
      mode?: unknown;
    } | null;
    if (previous?.mode === 'light' || previous?.mode === 'dark') return previous.mode;
  } catch {
    /* Storage may be unavailable. */
  }
  return 'system';
}

function storedTheme(): Theme {
  try {
    return readStoredTheme(window.localStorage);
  } catch {
    return DEFAULT_THEME;
  }
}

/*
 * Holds both appearance choices and mirrors them onto <html>.
 *
 * The boot script in `app/layout.tsx` has already put both on the element before first paint;
 * this takes over once React is up, so it seeds from defaults and corrects on mount (reading
 * storage during render would make the server and client disagree). Nothing below the provider
 * is keyed on either value, so switching theme repaints through CSS variables and does not
 * remount a form someone is halfway through.
 */
export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [colorMode, setColorModeState] = React.useState<ColorMode>('system');
  const [theme, setThemeState] = React.useState<Theme>(DEFAULT_THEME);
  const [systemDark, setSystemDark] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setColorModeState(storedColorMode());
    setThemeState(storedTheme());
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) {
      setReady(true);
      return;
    }
    setSystemDark(media.matches);
    setReady(true);
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolvedColorMode = colorMode === 'system' ? (systemDark ? 'dark' : 'light') : colorMode;
  React.useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle('dark', resolvedColorMode === 'dark');
  }, [ready, resolvedColorMode]);

  React.useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.theme = theme;
  }, [ready, theme]);

  const setColorMode = React.useCallback((next: ColorMode) => {
    setColorModeState(next);
    try {
      window.localStorage.setItem(COLOR_MODE_STORAGE_KEY, next);
    } catch {
      /* Keep this session's choice. */
    }
  }, []);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* Keep this session's choice. */
    }
  }, []);

  const value = React.useMemo(
    () => ({ colorMode, resolvedColorMode, setColorMode, theme, setTheme }),
    [colorMode, resolvedColorMode, setColorMode, theme, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
