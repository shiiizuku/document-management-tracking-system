import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReportsScreen } from '../src/features/reports/reports-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { monthlyReport } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, downloadMock, toastSuccess, toastError } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  downloadMock: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

// Every request in this file answers with one fixture, so the type list the labels come from is
// stubbed to the code-derived fallback rather than fed the fixture.
vi.mock('../src/features/org/queries', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../src/features/org/queries');
  const { documentTypeLabel } = await vi.importActual<{
    documentTypeLabel: (code: string) => string;
  }>('../src/components/dts/status-badge');
  return { ...actual, useDocumentTypeLabel: () => documentTypeLabel };
});

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, download: downloadMock };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }));

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReportsScreen', () => {
  it('shows the month totals and its register entries', async () => {
    apiMock.mockResolvedValue(monthlyReport());
    renderWithQuery(<ReportsScreen />);

    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('Received this month')).toBeInTheDocument();
    expect(screen.getByText('Incoming budget letter')).toBeInTheDocument();
  });

  it('shows no figures while the report is being produced', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<ReportsScreen />);
    expect(screen.queryByText('Incoming budget letter')).not.toBeInTheDocument();
  });

  it('explains a month with nothing in it', async () => {
    apiMock.mockResolvedValue(
      monthlyReport({
        documents: [],
        totals: { incoming: 0, outgoing: 0, foiRequests: 0, specialOrders: 0, total: 0 },
      }),
    );
    renderWithQuery(<ReportsScreen />);

    await waitFor(() => expect(screen.getByText(/Nothing was registered in/)).toBeInTheDocument());
  });

  it('reports a failed report and offers a retry', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 500, code: 'HTTP_500', message: 'Report engine unavailable' }),
    );
    renderWithQuery(<ReportsScreen />);

    await waitFor(() => expect(screen.getByText('Report engine unavailable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('asks the API for the month that was picked', async () => {
    apiMock.mockResolvedValue(monthlyReport({ month: 3 }));
    renderWithQuery(<ReportsScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Month'));
    await userEvent.click(screen.getByRole('option', { name: 'March' }));

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(expect.stringContaining('month=3')));
  });

  /*
   * Exports go through the transport, not a link: the request needs the session cookie, and a
   * refusal has to surface beside the button rather than as a navigation to an error page.
   */
  it.each([
    ['XLSX', 'xlsx'],
    ['PDF', 'pdf'],
  ])('downloads the %s export through the transport', async (label, format) => {
    apiMock.mockResolvedValue(monthlyReport());
    downloadMock.mockResolvedValue(`dts-monthly-2026-09.${format}`);
    renderWithQuery(<ReportsScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: label }));

    await waitFor(() =>
      expect(downloadMock).toHaveBeenCalledWith(
        expect.stringContaining(`/reports/monthly.${format}?`),
        expect.stringContaining(`.${format}`),
      ),
    );
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('reports a refused export without losing the screen', async () => {
    apiMock.mockResolvedValue(monthlyReport());
    downloadMock.mockRejectedValue(
      new ApiError({ status: 403, code: 'FORBIDDEN', message: 'Not permitted' }),
    );
    renderWithQuery(<ReportsScreen />);
    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'PDF' }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Export failed', {
        description: 'Not permitted',
      }),
    );
    expect(screen.getByText('Incoming budget letter')).toBeInTheDocument();
  });

  it('links each entry to its document', async () => {
    apiMock.mockResolvedValue(monthlyReport());
    renderWithQuery(<ReportsScreen />);

    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Incoming budget letter' })).toHaveAttribute(
        'href',
        '/documents/doc-1',
      ),
    );
  });
});
