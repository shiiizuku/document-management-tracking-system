import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '../src/components/theme-toggle';
import { THEME_STORAGE_KEY, ThemeProvider } from '../src/components/theme-provider';
import { TooltipProvider } from '../src/components/ui/tooltip';

afterEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.classList.remove('dark');
});

const renderToggle = () =>
  render(
    <ThemeProvider>
      <TooltipProvider>
        <ThemeToggle />
        <input aria-label="Unsubmitted draft" />
      </TooltipProvider>
    </ThemeProvider>,
  );

describe('ThemeToggle', () => {
  it('switches themes while keeping the colour mode and any unsaved input', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('dts.theme', 'dark');
    renderToggle();

    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
    await user.type(screen.getByRole('textbox', { name: 'Unsubmitted draft' }), 'Keep this text');
    await user.click(screen.getByRole('button', { name: 'Theme: Neutral pastel' }));

    await user.click(screen.getByRole('button', { name: 'Sage pastel' }));
    expect(document.documentElement.dataset.theme).toBe('sage');
    expect(document.documentElement).toHaveClass('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sage');
    expect(screen.getByRole('textbox', { name: 'Unsubmitted draft' })).toHaveValue(
      'Keep this text',
    );
  });

  it('shows swatches only, marks the current one, and closes back onto the trigger', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(THEME_STORAGE_KEY, 'civic');
    renderToggle();

    const trigger = await screen.findByRole('button', { name: 'Theme: Civic Ledger' });
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const swatches = screen
      .getAllByRole('button')
      .filter((button) => button.hasAttribute('aria-pressed'));
    expect(swatches.map((swatch) => swatch.getAttribute('aria-label'))).toEqual([
      'Neutral pastel',
      'Sage pastel',
      'Blush pastel',
      'Civic Ledger',
    ]);
    // Names are labels only: nothing in a swatch is visible text.
    swatches.forEach((swatch) => expect(swatch.textContent).toBe(''));
    expect(screen.getByRole('button', { name: 'Civic Ledger' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Blush pastel' }));
    expect(screen.queryByRole('button', { name: 'Sage pastel' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Theme: Blush pastel' })).toHaveFocus(),
    );
  });

  it('toggles the colour mode without touching the theme', async () => {
    const user = userEvent.setup();
    window.localStorage.setItem('dts.theme', 'light');
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sage');
    renderToggle();

    await user.click(await screen.findByRole('button', { name: 'Switch to dark mode' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(document.documentElement.dataset.theme).toBe('sage');
  });
});
