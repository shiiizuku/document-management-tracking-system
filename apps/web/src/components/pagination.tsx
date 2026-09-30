'use client';

import { pageCount } from '../lib/documents';

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, total, pageSize, onPageChange }: PaginationProps) {
  const pages = pageCount(total, pageSize);
  if (total === 0) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <div className="pagination">
      <span className="pagination-range">
        {first}–{last} of {total}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="secondary"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          ← Prev
        </button>
        <span className="pagination-page">
          Page {page} of {pages}
        </span>
        <button
          type="button"
          className="secondary"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
