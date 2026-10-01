'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { DocumentDirection } from '@dts/contracts';
import { api, download } from '@/lib/api';

/**
 * The monthly register — what came in and went out in a given month, within the caller's scope.
 *
 * The same figures are served three ways (on screen, as XLSX, as PDF) and all three are produced
 * by the server from one query, so an exported file can never disagree with the table it was
 * exported from. The client's only job is to ask for a month.
 */

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
  direction: DocumentDirection;
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

const reportKeys = {
  monthly: (year: number, month: number) => ['reports', 'monthly', year, month] as const,
};

export function useMonthlyReport(year: number, month: number) {
  return useQuery({
    queryKey: reportKeys.monthly(year, month),
    queryFn: () => api<MonthlyReport>(`/reports/monthly?year=${year}&month=${month}`),
    // A closed month cannot change, and the current one changes slowly. Five minutes stops the
    // month picker from re-requesting a report the user just looked at.
    staleTime: 5 * 60_000,
  });
}

/**
 * Downloads the month as a file.
 *
 * Through `download()` rather than a link, for the same reason as an attachment: the request
 * needs the session cookie, and a refusal has to surface as an error beside the button rather
 * than as a navigation to an error page. The server names the file; this only supplies a fallback
 * for the case where it does not.
 */
export function useReportDownload() {
  return useMutation({
    mutationFn: ({
      format,
      year,
      month,
    }: {
      format: 'xlsx' | 'pdf';
      year: number;
      month: number;
    }) =>
      download(
        `/reports/monthly.${format}?year=${year}&month=${month}`,
        `dts-monthly-${year}-${String(month).padStart(2, '0')}.${format}`,
      ),
  });
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

/** The month name for a 1-based month number, as the API and the picker both use. */
export const monthName = (month: number): string => MONTH_NAMES[month - 1] ?? String(month);
