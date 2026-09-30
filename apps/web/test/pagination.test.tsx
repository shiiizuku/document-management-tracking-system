import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Pagination } from '../src/components/pagination';

describe('Pagination', () => {
  it('renders nothing when there are no results', () => {
    const { container } = render(
      <Pagination page={1} total={0} pageSize={20} onPageChange={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the current range and page count', () => {
    render(<Pagination page={2} total={45} pageSize={20} onPageChange={() => undefined} />);
    expect(screen.getByText('21–40 of 45')).toBeInTheDocument();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
  });

  it('disables Prev on the first page and Next on the last', () => {
    const { rerender } = render(
      <Pagination page={1} total={45} pageSize={20} onPageChange={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: /prev/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(<Pagination page={3} total={45} pageSize={20} onPageChange={() => undefined} />);
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('moves to the next page', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={1} total={45} pageSize={20} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
