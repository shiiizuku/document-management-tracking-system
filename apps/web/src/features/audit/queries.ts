'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The audit trail, as the viewer reads it.
 *
 * The trail is append-only evidence, so this module has no mutations and never will — which is why
 * it is the smallest query module in the app. What it does own is the translation between a filter
 * the user set and the query the server understands, and the vocabulary of action names, because an
 * auditor filtering by "what happened" should not have to know that the stored value is
 * `document.workflow.accept`.
 */

export const AUDIT_PAGE_SIZE = 50;

/** One recorded action. The server's row, unchanged: evidence is not reshaped on the way out. */
export interface AuditEvent {
  id: string;
  /** `null` for an action with no authenticated actor — a failed or anonymous sign-in attempt. */
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  /** Ties this row to the structured log lines for the same request. Quoted to support. */
  correlationId: string;
  sourceIp: string | null;
  summary: Record<string, unknown>;
  occurredAt: string;
}

export interface AuditPage {
  items: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditFilters {
  /** An actor's user id. The API accepts it as `user`. */
  user: string;
  action: string;
  /** Inclusive lower bound, as a `yyyy-mm-dd` date input value. */
  from: string;
  /** Exclusive upper bound. The screen sends the day *after* the one the user picked. */
  to: string;
}

export const DEFAULT_AUDIT_FILTERS: AuditFilters = { user: '', action: '', from: '', to: '' };

const auditKeys = {
  all: ['audit'] as const,
  page: (filters: AuditFilters, page: number) => [...auditKeys.all, 'page', filters, page] as const,
};

/**
 * Turns the filters and a page number into the query the API expects.
 *
 * Two translations happen here and nowhere else. A page number becomes `limit`/`offset`, because
 * the trail is offset-paginated rather than page-numbered. And the `to` date becomes the start of
 * the *following* day: the server's upper bound is exclusive, so sending the picked date verbatim
 * would silently drop everything that happened on it — the single most likely way an audit filter
 * can mislead.
 */
export const auditQueryString = (
  filters: AuditFilters,
  page: number,
  pageSize: number = AUDIT_PAGE_SIZE,
): string => {
  const params = new URLSearchParams();
  if (filters.user) params.set('user', filters.user);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', `${filters.from}T00:00:00.000Z`);
  if (filters.to) params.set('to', exclusiveEndOf(filters.to));
  params.set('limit', String(pageSize));
  params.set('offset', String((Math.max(1, page) - 1) * pageSize));
  return params.toString();
};

/** Midnight at the start of the day after `date`, which is the exclusive end of `date` itself. */
const exclusiveEndOf = (date: string): string => {
  const end = new Date(`${date}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
};

export function useAuditEvents(filters: AuditFilters, page: number) {
  return useQuery({
    queryKey: auditKeys.page(filters, page),
    queryFn: () => api<AuditPage>(`/audit-events?${auditQueryString(filters, page)}`),
    placeholderData: (previous) => previous,
  });
}

/**
 * The action names the filter offers.
 *
 * A fixed list rather than a facet query, because the API has no "distinct actions" endpoint and
 * the vocabulary is a compile-time fact about this codebase: every string here is written by an
 * `audit.write` call somewhere in the API. A free-text box instead would be a worse control — an
 * auditor cannot guess `document.routing-slip-exported`.
 *
 * It is deliberately allowed to be incomplete. Rows carry whatever action was recorded, and the
 * table renders an unknown one as itself, so a name added to the API but not to this list costs a
 * missing dropdown entry rather than a broken screen.
 */
export const AUDIT_ACTION_GROUPS: readonly { label: string; actions: readonly string[] }[] = [
  {
    label: 'Sign-in',
    actions: ['auth.login', 'auth.logout'],
  },
  {
    label: 'Documents',
    actions: [
      'document.created',
      'document.metadata-edited',
      'document.assigned',
      'document.routed',
      'document.shared',
      'document.deleted',
      'document.restored',
      'document.reference-linked',
      'document.reference-unlinked',
      // Two actions, not one (decision 170): looking at a slip and taking a copy of it away are
      // different events, and telling them apart is the reason an auditor opens this filter.
      'document.routing-slip-viewed',
      'document.routing-slip-exported',
    ],
  },
  {
    label: 'Workflow',
    actions: [
      // Taking custody and acknowledging a copy each have their own name on success; the
      // `document.workflow.*` names below are what a refused command records.
      'document.custody-accepted',
      'document.copy-acknowledged',
      'document.workflow.accept',
      'document.workflow.request_revision',
      'document.workflow.resubmit',
      'document.workflow.submit_for_signature',
      'document.workflow.sign',
      'document.workflow.prepare_release',
      'document.workflow.release',
      'document.workflow.archive',
    ],
  },
  {
    label: 'Files',
    actions: [
      'attachment.uploaded',
      'attachment.downloaded',
      'attachment.previewed',
      'attachment.scanned',
      'attachment.scan-recorded',
    ],
  },
  {
    label: 'Accounts and organization',
    actions: [
      'account-request.submitted',
      'account-request.approved',
      'account-request.rejected',
      'user.created',
      'user.updated',
      'user.deactivated',
      'user.reactivated',
      'user.password-changed',
      'user.password-reset',
      'user.photo-updated',
      'division.created',
      'division.updated',
      'section.created',
      'section.updated',
    ],
  },
  {
    label: 'Reports',
    actions: ['report.monthly-viewed', 'report.exported'],
  },
];

/** Every offered action, flattened — for the filter's options and for exhaustiveness in tests. */
export const AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_GROUPS.flatMap(
  (group) => group.actions,
);

/**
 * How an action name reads to a person.
 *
 * `document.workflow.request_revision` becomes "Document workflow · request revision". Mechanical
 * on purpose: a hand-written label per action would be a second vocabulary to keep in step with the
 * API's, and the stored names are already written to be read.
 */
export const auditActionLabel = (action: string): string => {
  const segments = action.split('.');
  const last = segments.pop() ?? action;
  const subject = segments.join(' ').replaceAll('-', ' ');
  const verb = last.replaceAll('_', ' ').replaceAll('-', ' ');
  const prefix = subject === '' ? '' : `${subject.charAt(0).toUpperCase()}${subject.slice(1)} · `;
  return `${prefix}${verb}`;
};
