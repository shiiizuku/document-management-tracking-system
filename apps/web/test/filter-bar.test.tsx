import { render, screen, waitFor } from '@testing-library/react';
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
  {
    id: 'priority',
    label: 'Priority',
    anyLabel: 'Any priority',
    options: [{ value: 'URGENT', label: 'Urgent' }],
  },
] as const;

const search = (overrides: Partial<NonNullable<FilterBarProps['search']>> = {}) => ({
  value: '',
  applied: '',
  placeholder: 'Search title, number, sender',
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  onClear: vi.fn(),
  ...overrides,
});

const renderBar = (overrides: Partial<FilterBarProps> = {}) =>
  render(
    <FilterBar
      search={search()}
      selects={selects}
      values={{ status: '', priority: '' }}
      onSelectChange={vi.fn()}
      onClear={vi.fn()}
      {...overrides}
    />,
  );

/** The dropdowns live behind the "Advanced search" disclosure, which always starts closed. */
const advancedButton = () => screen.getByRole('button', { name: /Advanced search/ });
const openAdvanced = () => userEvent.click(advancedButton());

describe('FilterBar', () => {
  it('applies a dropdown choice immediately', async () => {
    const onSelectChange = vi.fn();
    renderBar({ onSelectChange });

    await openAdvanced();
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(screen.getByRole('option', { name: 'Pending' }));

    expect(onSelectChange).toHaveBeenCalledWith('status', 'PENDING');
  });

  // Radix will not accept '' as an option value, but "no filter" is a real choice. Callers must
  // still see the empty string, never the sentinel this component uses internally.
  it('reports clearing one filter as an empty value, not a sentinel', async () => {
    const onSelectChange = vi.fn();
    renderBar({ onSelectChange, values: { status: 'PENDING' } });

    await openAdvanced();
    await userEvent.click(screen.getByLabelText('Status'));
    await userEvent.click(screen.getByRole('option', { name: 'Any status' }));

    expect(onSelectChange).toHaveBeenCalledWith('status', '');
  });

  it('shows the active filter in the trigger, marked as active', async () => {
    renderBar({ values: { status: 'RELEASED' } });
    await openAdvanced();
    expect(screen.getByLabelText('Status')).toHaveTextContent('Released');
    expect(screen.getByLabelText('Status')).toHaveAttribute('data-active');
    expect(screen.getByLabelText('Priority')).not.toHaveAttribute('data-active');
  });

  // Typing must not fire a request per keystroke; the search applies on submit.
  it('keeps search outside the panel and reports it only on submit', async () => {
    const onChange = vi.fn();
    const onSubmit = vi.fn();
    renderBar({ search: search({ onChange, onSubmit }) });

    await userEvent.type(screen.getByLabelText('Search'), 'memo');
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText('Search'), '{Enter}');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('starts closed even when filtered, and wires the button to the panel', async () => {
    renderBar({ values: { status: 'PENDING' } });
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');

    await openAdvanced();
    expect(advancedButton()).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('group', { name: 'Advanced search' });
    expect(advancedButton()).toHaveAttribute('aria-controls', panel.id);
  });

  it('closes the panel from "Show results" without touching the filters', async () => {
    const onSelectChange = vi.fn();
    renderBar({ onSelectChange });
    await openAdvanced();

    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');
    expect(onSelectChange).not.toHaveBeenCalled();
  });

  /*
   * The count badge: one per active filter of any kind — select, search, or a chip the screen
   * supplies — hidden at zero, and read out in words.
   */
  describe('the count badge', () => {
    const badge = () => document.querySelector('[data-slot="filter-count"]');

    it('is hidden when nothing is filtered', () => {
      renderBar();
      expect(badge()).toBeNull();
      expect(advancedButton()).toHaveAccessibleName(/^Advanced search$/);
    });

    it('counts selects, the applied search and extra chips together', () => {
      renderBar({
        values: { status: 'PENDING', priority: 'URGENT' },
        search: search({ applied: 'budget' }),
        extraChips: [{ id: 'overdue', label: 'Overdue', onRemove: vi.fn() }],
      });
      expect(badge()).toHaveTextContent('4');
      expect(advancedButton()).toHaveAccessibleName(/4 filters active/);
    });

    it('ignores a typed search that has not been applied', () => {
      renderBar({ search: search({ value: 'draft', applied: '' }) });
      expect(badge()).toBeNull();
    });

    it('says "1 filter" in the singular', () => {
      renderBar({ values: { status: 'PENDING' } });
      expect(badge()).toHaveTextContent('1');
      expect(advancedButton()).toHaveAccessibleName(/1 filter active/);
    });
  });

  describe('active-filter chips', () => {
    it('names each active filter, and removes one from its chip', async () => {
      const onSelectChange = vi.fn();
      const onClearSearch = vi.fn();
      renderBar({
        onSelectChange,
        values: { status: 'PENDING' },
        search: search({ applied: 'budget', onClear: onClearSearch }),
      });

      expect(screen.getByText('Filtered by')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Remove filter Status: Pending' }));
      expect(onSelectChange).toHaveBeenCalledWith('status', '');

      await userEvent.click(screen.getByRole('button', { name: 'Remove filter Search: budget' }));
      expect(onClearSearch).toHaveBeenCalledOnce();
    });

    it('labels a flag chip by its name alone', async () => {
      const onRemove = vi.fn();
      renderBar({ extraChips: [{ id: 'overdue', label: 'Overdue', onRemove }] });

      await userEvent.click(screen.getByRole('button', { name: 'Remove filter Overdue' }));
      expect(onRemove).toHaveBeenCalledOnce();
    });

    it('offers Clear all only once something is filtered', async () => {
      const onClear = vi.fn();
      const { unmount } = renderBar({ onClear });
      expect(screen.queryByRole('button', { name: 'Clear all' })).not.toBeInTheDocument();
      unmount();

      renderBar({ onClear, values: { status: 'PENDING' } });
      await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
      expect(onClear).toHaveBeenCalledOnce();
    });
  });

  it('opens itself once when an unfiltered list comes back empty', async () => {
    const { rerender } = renderBar({ emptyResult: undefined });
    expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <FilterBar
        search={search()}
        selects={selects}
        values={{ status: '', priority: '' }}
        onSelectChange={vi.fn()}
        onClear={vi.fn()}
        emptyResult
      />,
    );
    await waitFor(() => expect(advancedButton()).toHaveAttribute('aria-expanded', 'true'));
  });

  it('stays closed when the empty list is explained by a chip', () => {
    renderBar({ values: { status: 'PENDING' }, emptyResult: true });
    expect(advancedButton()).toHaveAttribute('aria-expanded', 'false');
  });
});
