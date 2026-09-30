import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RegistryControls } from '../src/components/registry-controls';
import { DEFAULT_FILTERS } from '../src/lib/documents';

const noop = () => undefined;

describe('RegistryControls', () => {
  it('applies a status filter immediately via onChange', async () => {
    const onChange = vi.fn();
    render(
      <RegistryControls
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        onSearchSubmit={noop}
        onClear={noop}
      />,
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'PENDING');
    expect(onChange).toHaveBeenCalledWith({ status: 'PENDING' });
  });

  it('submits the free-text search rather than filtering per keystroke', async () => {
    const onSearchSubmit = vi.fn();
    render(
      <RegistryControls
        filters={DEFAULT_FILTERS}
        onChange={noop}
        onSearchSubmit={onSearchSubmit}
        onClear={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onSearchSubmit).toHaveBeenCalled();
  });

  it('toggles the sort order', async () => {
    const onChange = vi.fn();
    render(
      <RegistryControls
        filters={DEFAULT_FILTERS}
        onChange={onChange}
        onSearchSubmit={noop}
        onClear={noop}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /sort descending/i }));
    expect(onChange).toHaveBeenCalledWith({ order: 'asc' });
  });

  it('shows Clear only when a filter is active', () => {
    const { rerender } = render(
      <RegistryControls
        filters={DEFAULT_FILTERS}
        onChange={noop}
        onSearchSubmit={noop}
        onClear={noop}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    rerender(
      <RegistryControls
        filters={{ ...DEFAULT_FILTERS, status: 'PENDING' }}
        onChange={noop}
        onSearchSubmit={noop}
        onClear={noop}
      />,
    );
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
});
