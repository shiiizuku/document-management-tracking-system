import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FilterBar, type FilterBarProps } from '../src/components/dts/filter-bar';

const selects = [
  {
    id: 'status',
    label: 'Status',
    anyLabel: 'Any status',
    options: [
      { value: 'PENDING', label: 'Pending' },
      { value: 'RELEASED', label: 'Released' },
    ],
  },
] as const;

const renderBar = (overrides: Partial<FilterBarProps> = {}) =>
  render(
    <FilterBar
      search={{
        value: '',
        placeholder: 'Search title, number, sender',
        onChange: vi.fn(),
        onSubmit: vi.fn(),
      }}
      selects={selects}
      values={{ status: '' }}
      onSelectChange={vi.fn()}
      onClear={vi.fn()}
      {...overrides}
    />,
  );

describe('FilterBar', () => {
  it('applies a dropdown choice immediately', async () => {
    const onSelectChange = vi.fn();
    renderBar({ onSelectChange });

    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(screen.getByRole('option', { name: 'Pending' }));

    expect(onSelectChange).toHaveBeenCalledWith('status', 'PENDING');
  });

  // Radix will not accept '' as an option value, but "no filter" is a real choice. Callers must
  // still see the empty string, never the sentinel this component uses internally.
  it('reports clearing one filter as an empty value, not a sentinel', async () => {
    const onSelectChange = vi.fn();
    renderBar({ onSelectChange, values: { status: 'PENDING' } });

    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(screen.getByRole('option', { name: 'Any status' }));

    expect(onSelectChange).toHaveBeenCalledWith('status', '');
  });

  it('shows the active filter in the trigger', () => {
    renderBar({ values: { status: 'RELEASED' } });
    expect(screen.getByLabelText('Status')).toHaveTextContent('Released');
  });

  // Typing must not fire a request per keystroke; the search applies on submit.
  it('reports free-text search only on submit', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    renderBar({ search: { value: '', placeholder: 'Search', onChange, onSubmit } });

    await userEvent.type(screen.getByLabelText('Search'), 'memo');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('offers Clear only once something is filtered', () => {
    const { unmount } = renderBar();
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
    unmount();

    renderBar({ values: { status: 'PENDING' } });
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument();
  });

  it('offers Clear for a filter it does not own, so no screen can get stuck filtered', () => {
    renderBar({ hasOtherActiveFilters: true });
    expect(screen.getByRole('button', { name: /Clear/ })).toBeInTheDocument();
  });
});
