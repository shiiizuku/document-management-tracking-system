import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../src/components/theme-toggle';
import { DESIGN_SYSTEM_STORAGE_KEY, ThemeProvider } from '../src/components/theme-provider';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.designSystem;
});

describe('ThemeToggle', () => {
  it('switches design systems while keeping the color mode', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Switch to Material 3 Expressive' }));

    expect(document.documentElement.dataset.designSystem).toBe('md3');
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem(DESIGN_SYSTEM_STORAGE_KEY)).toBe('md3');
    expect(screen.getByText('M3 Expressive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Switch to shadcn UI' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Unsubmitted draft' })).toHaveValue(
      'Keep this text',
    );
  });
});
