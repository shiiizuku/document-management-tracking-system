'use client';

import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';
export const ACCENTS = ['default', 'blue', 'green', 'violet', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];
type ThemeContext = {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  accent: Accent;
  setAccent: (accent: Accent) => void;
};
const ThemeContext = React.createContext<ThemeContext | null>(null);
const STORAGE_KEY = 'dts.theme';
export const ACCENT_STORAGE_KEY = 'dts.accent.v1';

function storedAccent(): Accent {
  try {
    const value = window.localStorage.getItem(ACCENT_STORAGE_KEY);
    return ACCENTS.find((accent) => accent === value) ?? 'default';
  } catch {
    return 'default';
  }
}

function storedTheme(): Theme {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
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

export function ThemeProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [theme, setThemeState] = React.useState<Theme>('system');
  const [accent, setAccentState] = React.useState<Accent>('default');
  const [systemDark, setSystemDark] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setThemeState(storedTheme());
    setAccentState(storedAccent());
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

  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  React.useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [ready, resolvedTheme]);

  React.useEffect(() => {
    if (!ready) return;
    document.documentElement.dataset.accent = accent;
    delete document.documentElement.dataset.designSystem;
  }, [ready, accent]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Keep this session's choice. */
    }
  }, []);

  const setAccent = React.useCallback((next: Accent) => {
    setAccentState(next);
    try {
      window.localStorage.setItem(ACCENT_STORAGE_KEY, next);
    } catch {
      /* Keep this session's choice. */
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
