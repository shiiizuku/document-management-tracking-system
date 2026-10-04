'use client';

import * as React from 'react';

type Theme = 'light' | 'dark' | 'system';
export type DesignSystem = 'shadcn' | 'md3';
type ThemeContext = {
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  designSystem: DesignSystem;
  setDesignSystem: (system: DesignSystem) => void;
};
const ThemeContext = React.createContext<ThemeContext | null>(null);
const STORAGE_KEY = 'dts.theme';
export const DESIGN_SYSTEM_STORAGE_KEY = 'dts.design-system.v1';

function storedDesignSystem(): DesignSystem {
  try {
    return window.localStorage.getItem(DESIGN_SYSTEM_STORAGE_KEY) === 'md3' ? 'md3' : 'shadcn';
  } catch {
    return 'shadcn';
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
  const [designSystem, setDesignSystemState] = React.useState<DesignSystem>('shadcn');
  const [systemDark, setSystemDark] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    setThemeState(storedTheme());
    setDesignSystemState(storedDesignSystem());
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
    document.documentElement.dataset.designSystem = designSystem;
  }, [ready, designSystem]);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* Keep this session's choice. */
    }
  }, []);

  const setDesignSystem = React.useCallback((next: DesignSystem) => {
    setDesignSystemState(next);
    try {
      window.localStorage.setItem(DESIGN_SYSTEM_STORAGE_KEY, next);
    } catch {
      /* Keep this session's choice. */
    }
  }, []);

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, designSystem, setDesignSystem }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider');
  return context;
}
