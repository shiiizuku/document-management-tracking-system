import { DEFAULT_AUDIT_FILTERS, type AuditFilters } from './queries';

/**
 * The audit viewer's filter state, read from and written to the URL.
 *
 * The same contract as the registry's `url-state`, and for the same reasons: a filtered trail has
 * to be linkable — "here is what I found, see for yourself" is the whole point of an audit viewer —
 * and it has to come back intact on the back button.
 *
 * Validation matters more here than elsewhere. These values are forwarded to the API as a date
 * range, and the server answers a malformed date with a 400; a pasted or truncated URL would then
 * show an auditor an error page instead of an empty result.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Actor ids are rows, not an enum, so they are checked for shape rather than membership. */
const asUuid = (raw: string | null): string => (raw !== null && UUID.test(raw) ? raw : '');

/**
 * A `yyyy-mm-dd` date, verified to be a real one.
 *
 * The shape check alone would pass `2026-02-31`, which `new Date` silently rolls forward to March —
 * so the round-trip comparison is what makes a nonsense date drop out instead of quietly shifting
 * the window the auditor thinks they are looking at.
 */
const asDate = (raw: string | null): string => {
  if (raw === null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw ? '' : raw;
};

/**
 * An action name, accepted as free text rather than checked against the offered list.
 *
 * Deliberate: the API records action names this build may not know about (a name added later, or
 * one recorded before a rename), and an auditor following a link to such a row must still see it.
 * The value only ever reaches the API as an equality filter, so an unknown name returns nothing
 * rather than erroring — the safe direction. Length-capped because the server caps it too.
 */
const asAction = (raw: string | null): string =>
  raw !== null && /^[\w.:-]{1,100}$/.test(raw) ? raw : '';

export const parseAuditFilters = (params: URLSearchParams): AuditFilters => ({
  user: asUuid(params.get('user')),
  action: asAction(params.get('action')),
  from: asDate(params.get('from')),
  to: asDate(params.get('to')),
});

/** Page 1 for anything that is not a page number, so `?page=abc` shows the first page. */
export const parseAuditPage = (params: URLSearchParams): number => {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page > 0 ? page : 1;
};

/** Serialises filters and page back into a query string, omitting anything left at its default. */
export const auditFiltersToParams = (filters: AuditFilters, page: number): string => {
  const params = new URLSearchParams();
  if (filters.user) params.set('user', filters.user);
  if (filters.action) params.set('action', filters.action);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (page > 1) params.set('page', String(page));
  return params.toString();
};

/** Whether anything is narrowing the trail, which is what decides if Clear is offered. */
export const hasActiveAuditFilters = (filters: AuditFilters): boolean =>
  filters.user !== DEFAULT_AUDIT_FILTERS.user ||
  filters.action !== DEFAULT_AUDIT_FILTERS.action ||
  filters.from !== DEFAULT_AUDIT_FILTERS.from ||
  filters.to !== DEFAULT_AUDIT_FILTERS.to;
