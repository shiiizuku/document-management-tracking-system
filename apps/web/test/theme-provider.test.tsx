import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY, ThemeProvider, useTheme } from '../src/components/theme-provider';
import {
  LEGACY_ACCENT_STORAGE_KEY,
  readStoredTheme,
  themeBootScript,
} from '../src/components/theme-storage';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

const reset = () => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.theme;
};
beforeEach(reset);
afterEach(reset);

describe('ThemeProvider', () => {
  it('keeps a saved dark mode and persists a new choice', async () => {
    window.localStorage.setItem('dts.theme', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.resolvedColorMode).toBe('dark'));
    expect(document.documentElement).toHaveClass('dark');

    act(() => result.current.setColorMode('light'));
    expect(result.current.resolvedColorMode).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('dts.theme')).toBe('light');
  });

  it('preserves a previously selected mode when upgrading', async () => {
    window.localStorage.setItem('dts.appearance', JSON.stringify({ mode: 'dark', accent: 'sage' }));
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.resolvedColorMode).toBe('dark'));
    expect(document.documentElement).toHaveClass('dark');
  });

  // `dts.theme` is the colour mode; the palette has its own key, and the two must not collide.
  it('keeps the theme independent of colour mode, under its own key', async () => {
    window.localStorage.setItem('dts.theme', 'dark');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'blush');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.theme).toBe('blush'));
    expect(document.documentElement.dataset.theme).toBe('blush');
    expect(result.current.resolvedColorMode).toBe('dark');

    act(() => result.current.setTheme('civic'));
    expect(document.documentElement.dataset.theme).toBe('civic');
    expect(result.current.resolvedColorMode).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('civic');
    expect(window.localStorage.getItem('dts.theme')).toBe('dark');
  });

  it('falls back to neutral when the saved theme is unknown', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'violet');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('neutral'));
    expect(result.current.theme).toBe('neutral');
  });

  it('migrates a legacy accent on first load', async () => {
    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'rose');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.theme).toBe('blush'));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('blush');
    expect(window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY)).toBeNull();
  });
});

/*
 * The migration runs in two places — the provider, and the boot script that has to run before
 * React — so both are held to the same table.
 */
const MIGRATIONS = [
  ['green', 'sage'],
  ['rose', 'blush'],
  ['blue', 'neutral'],
  ['violet', 'neutral'],
  ['default', 'neutral'],
  ['constructor', 'neutral'],
] as const;

const runBootScript = () => {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the script is a fixed string we author
  const boot = new Function(themeBootScript) as () => void;
  boot();
};

describe('theme migration', () => {
  it.each(MIGRATIONS)('maps the %s accent to the %s theme, once', (accent, theme) => {
    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, accent);

    expect(readStoredTheme(window.localStorage)).toBe(theme);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
    expect(window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY)).toBeNull();
  });

  it.each(MIGRATIONS)('boot script: maps %s to %s before first paint', (accent, theme) => {
    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, accent);

    runBootScript();

    expect(document.documentElement.dataset.theme).toBe(theme);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(theme);
    expect(window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY)).toBeNull();
  });

  it('never lets a leftover accent overwrite a theme already chosen', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'civic');
    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'green');

    runBootScript();
    expect(document.documentElement.dataset.theme).toBe('civic');
    expect(window.localStorage.getItem(LEGACY_ACCENT_STORAGE_KEY)).toBeNull();

    window.localStorage.setItem(LEGACY_ACCENT_STORAGE_KEY, 'green');
    expect(readStoredTheme(window.localStorage)).toBe('civic');
  });

  it('boot script: defaults to neutral without writing anything when nothing is stored', () => {
    runBootScript();

    expect(document.documentElement.dataset.theme).toBe('neutral');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });
});
