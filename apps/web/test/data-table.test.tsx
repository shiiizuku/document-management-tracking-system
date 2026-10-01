import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
} from '../src/components/dts/data-table';
import { EmptyState } from '../src/components/dts/empty-state';
import { ApiError } from '../src/lib/api';

interface Row {
  id: string;
  title: string;
  registered: string;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'title', header: 'Document', cell: (row) => row.title },
  { id: 'createdAt', header: 'Registered', cell: (row) => row.registered, sortable: true },
];

const rows: Row[] = [
  { id: 'a', title: 'Incoming letter', registered: '2026-09-01' },
  { id: 'b', title: 'Special order 14', registered: '2026-09-02' },
];

const renderTable = (overrides: Partial<DataTableProps<Row>> = {}) =>
  render(
    <DataTable<Row>
      caption="Documents"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      total={42}
      page={2}
      pageSize={20}
      onPageChange={vi.fn()}
      empty={<EmptyState title="Nothing here" />}
      {...overrides}
    />,
  );

describe('DataTable', () => {
  it('renders a page of rows', () => {
    renderTable();
    expect(screen.getByText('Incoming letter')).toBeInTheDocument();
    expect(screen.getByText('Special order 14')).toBeInTheDocument();
  });

  it('shows placeholders instead of rows while loading', () => {
    renderTable({ isLoading: true });
    expect(screen.queryByText('Incoming letter')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();
  });

  // "Loading" and "nothing matched" look alike if the empty state renders too early, which is how
  // a slow list ends up telling the user their filter found nothing.
  it('shows the empty state only once the query has settled', () => {
    renderTable({ rows: [], isLoading: false });
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('reports the server error and offers a retry instead of an empty list', async () => {
    const onRetry = vi.fn();
    renderTable({
      error: new ApiError({
        status: 500,
        code: 'HTTP_500',
        message: 'Registry unavailable',
        correlationId: 'corr-7',
      }),
      onRetry,
    });

    expect(screen.getByText('Registry unavailable')).toBeInTheDocument();
    expect(screen.getByText('corr-7')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('counts the server total, not the rows on screen', () => {
    renderTable();
    expect(screen.getByText('Showing 21-40 of 42')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('reads correctly with no results at all', () => {
    renderTable({ rows: [], total: 0, page: 1 });
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
  });

  it('pages forward and back without touching the row order itself', async () => {
    const onPageChange = vi.fn();
    renderTable({ onPageChange });

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('disables paging past either end', () => {
    renderTable({ page: 1, total: 10, pageSize: 20 });
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('asks the server for a descending sort on a column first chosen', async () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });

    await userEvent.click(screen.getByRole('button', { name: /Registered/ }));
    expect(onSortChange).toHaveBeenCalledWith({ field: 'createdAt', order: 'desc' });
  });

  it('flips to ascending on a second click of the active column', async () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange, sort: { field: 'createdAt', order: 'desc' } });

    await userEvent.click(screen.getByRole('button', { name: /Registered/ }));
    expect(onSortChange).toHaveBeenCalledWith({ field: 'createdAt', order: 'asc' });
  });

  it('announces the active sort direction on the column header', () => {
    renderTable({ onSortChange: vi.fn(), sort: { field: 'createdAt', order: 'asc' } });
    expect(screen.getByRole('columnheader', { name: /Registered/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('leaves headers unsortable when the caller handles no sorting', () => {
    renderTable();
    expect(screen.queryByRole('button', { name: /Registered/ })).not.toBeInTheDocument();
  });

  it('opens a row on click', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    await userEvent.click(screen.getByText('Incoming letter'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });

  // A clickable row that only answers a mouse is unreachable for anyone navigating by keyboard,
  // and on these screens the row is the only way into a record.
  it('opens the focused row from the keyboard', async () => {
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
