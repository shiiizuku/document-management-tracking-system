import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DESIGN_SYSTEM_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from '../src/components/theme-provider';

const wrapper = ({ children }: { children: ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.designSystem;
});

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('dark');
  delete document.documentElement.dataset.designSystem;
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

  it('keeps the design system independent of color mode and persists the selection', async () => {
    window.localStorage.setItem('dts.theme', 'dark');
    window.localStorage.setItem(DESIGN_SYSTEM_STORAGE_KEY, 'md3');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(result.current.designSystem).toBe('md3'));
    expect(document.documentElement.dataset.designSystem).toBe('md3');
    expect(result.current.resolvedTheme).toBe('dark');

    act(() => result.current.setDesignSystem('shadcn'));
    expect(document.documentElement.dataset.designSystem).toBe('shadcn');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(window.localStorage.getItem(DESIGN_SYSTEM_STORAGE_KEY)).toBe('shadcn');
  });

  it('uses shadcn when the saved design system is invalid', async () => {
    window.localStorage.setItem(DESIGN_SYSTEM_STORAGE_KEY, 'unknown');
    const { result } = renderHook(() => useTheme(), { wrapper });

    await waitFor(() => expect(document.documentElement.dataset.designSystem).toBe('shadcn'));
    expect(result.current.designSystem).toBe('shadcn');
  });
});
