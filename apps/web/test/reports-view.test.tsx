import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsView } from '../src/components/reports-view';
import type * as ReportsModule from '../src/lib/reports';
import type { MonthlyReport } from '../src/lib/reports';

const { fetchMock, downloadMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  downloadMock: vi.fn(),
}));

vi.mock('../src/lib/reports', async () => {
  const actual = await vi.importActual<typeof ReportsModule>('../src/lib/reports');
  return { ...actual, fetchMonthlyReport: fetchMock, downloadMonthlyReport: downloadMock };
});

const report: MonthlyReport = {
  year: 2026,
  month: 9,
  totals: { incoming: 1, outgoing: 0, foiRequests: 0, specialOrders: 0, total: 1 },
  documents: [
    {
      id: 'd1',
      title: 'Quarterly budget memorandum',
      referenceNumber: null,
      sender: 'Finance Department',
      company: null,
      type: 'MEMORANDUM',
      direction: 'INCOMING',
      createdAt: '2026-09-30T00:00:00Z',
      divisionId: 'div',
      sectionId: null,
      confidential: false,
    },
  ],
};

afterEach(() => vi.clearAllMocks());

describe('ReportsView', () => {
  it('renders the totals and document table for the loaded month', async () => {
    fetchMock.mockResolvedValue(report);
    render(<ReportsView />);
    expect(await screen.findByText('Quarterly budget memorandum')).toBeInTheDocument();
    // Total tile shows 1.
    expect(screen.getByText('Total').closest('article')).toHaveTextContent('1');
  });

  it('downloads the report as XLSX', async () => {
    fetchMock.mockResolvedValue(report);
    downloadMock.mockResolvedValue(undefined);
    render(<ReportsView />);
    await screen.findByText('Quarterly budget memorandum');
    await userEvent.click(screen.getByRole('button', { name: /XLSX/ }));
    expect(downloadMock).toHaveBeenCalledWith('xlsx', expect.any(Number), expect.any(Number));
  });
});
