import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACCENT_STORAGE_KEY, ThemeProvider, useTheme } from '../src/components/theme-provider';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.accent;
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.accent;
});

describe('ThemeProvider', () => {
  it('keeps a saved dark theme and persists a new choice', async () => {
    window.localStorage.setItem('dts.theme', 'dark');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.resolvedTheme).toBe('dark'));
    expect(document.documentElement).toHaveClass('dark');

    act(() => result.current.setTheme('light'));
    expect(result.current.resolvedTheme).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
    expect(window.localStorage.getItem('dts.theme')).toBe('light');
  });

  it('preserves a previously selected mode when upgrading', async () => {
    window.localStorage.setItem('dts.appearance', JSON.stringify({ mode: 'dark', accent: 'sage' }));
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.resolvedTheme).toBe('dark'));
    expect(document.documentElement).toHaveClass('dark');
  });

  it('keeps the accent independent of color mode and persists the selection', async () => {
    window.localStorage.setItem('dts.theme', 'dark');
    window.localStorage.setItem(ACCENT_STORAGE_KEY, 'violet');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.accent).toBe('violet'));
    expect(document.documentElement.dataset.accent).toBe('violet');
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => result.current.setAccent('default'));
    expect(document.documentElement.dataset.accent).toBe('default');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('default');
  });

  it('uses default when the saved accent is invalid', async () => {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, 'unknown');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(document.documentElement.dataset.accent).toBe('default'));
    expect(result.current.accent).toBe('default');
  });
});
