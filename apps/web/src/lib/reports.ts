import { api, API_URL } from './api';

export interface ReportTotals {
  incoming: number;
  outgoing: number;
  foiRequests: number;
  specialOrders: number;
  total: number;
}

export interface ReportDocument {
  id: string;
  title: string;
  referenceNumber: string | null;
  sender: string | null;
  company: string | null;
  type: string;
  direction: string;
  createdAt: string;
  divisionId: string;
  sectionId: string | null;
  confidential: boolean;
}

export interface MonthlyReport {
  year: number;
  month: number;
  totals: ReportTotals;
  documents: ReportDocument[];
}

export const fetchMonthlyReport = (year: number, month: number): Promise<MonthlyReport> =>
  api<MonthlyReport>(`/reports/monthly?year=${year}&month=${month}`);

/** Downloads the monthly report as a file (XLSX or PDF), fetched with the session cookie. */
export async function downloadMonthlyReport(
  format: 'xlsx' | 'pdf',
  year: number,
  month: number,
): Promise<void> {
  const response = await fetch(`${API_URL}/reports/monthly.${format}?year=${year}&month=${month}`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Report download failed');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `dts-monthly-${year}-${String(month).padStart(2, '0')}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
