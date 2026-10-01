'use client';

import { useQuery } from '@tanstack/react-query';
import type { WorkflowStatus } from '@dts/contracts';
import { api } from '@/lib/api';

/**
 * The dashboard's figures, as one scoped answer from the server.
 *
 * Every number here is computed with the same scope predicate the registry list uses, so the tiles
 * and the chart reconcile with what the user finds when they click through. That is why this is a
 * single endpoint rather than the client counting a loaded page: the previous UI derived its
 * metrics from whichever twenty rows happened to be on screen, which made them wrong for anyone
 * with more than one page of documents.
 */

export interface DivisionPending {
  divisionId: string;
  divisionName: string;
  total: number;
}

export interface ActivityEntry {
  id: string;
  documentId: string;
  trackingNumber: string;
  title: string;
  action: string;
  fromStatus: WorkflowStatus | null;
  toStatus: WorkflowStatus;
  actorId: string;
  actorName: string;
  occurredAt: string;
}

export interface DashboardSummary {
  total: number;
  byStatus: Record<WorkflowStatus, number>;
  overdue: number;
  pendingByDivision: DivisionPending[];
  recentActivity: ActivityEntry[];
}

const dashboardKeys = {
  summary: ['dashboard', 'summary'] as const,
};

export function useDashboardSummary() {
  return useQuery({
    queryKey: dashboardKeys.summary,
    queryFn: () => api<DashboardSummary>('/dashboard/summary'),
  });
}
