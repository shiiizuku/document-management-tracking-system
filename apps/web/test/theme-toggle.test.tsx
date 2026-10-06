import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../src/components/theme-toggle';
import { ACCENT_STORAGE_KEY, ThemeProvider } from '../src/components/theme-provider';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.accent;
});

describe('ThemeToggle', () => {
  it('switches accents while keeping the color mode', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('dts.theme', 'dark');
    render(
      <ThemeProvider>
        <TooltipProvider>
          <ThemeToggle />
          <input aria-label="Unsubmitted draft" />
        </TooltipProvider>
      </ThemeProvider>,
    );

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    await user.type(screen.getByRole('textbox', { name: 'Unsubmitted draft' }), 'Keep this text');
    await user.click(screen.getByRole('button', { name: 'Choose accent color: default' }));

    await user.click(screen.getByRole('button', { name: 'violet' }));
    expect(document.documentElement.dataset.accent).toBe('violet');
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('violet');
    expect(screen.getByRole('button', { name: 'violet' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('textbox', { name: 'Unsubmitted draft' })).toHaveValue(
      'Keep this text',
    );
  });
});
