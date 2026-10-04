import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from '../src/components/theme-provider';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
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
});
