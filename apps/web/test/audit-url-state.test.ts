import { describe, expect, it } from 'vitest';
import { AUDIT_PAGE_SIZE, auditActionLabel, auditQueryString } from '../src/features/audit/queries';
import {
  auditFiltersToParams,
  hasActiveAuditFilters,
  parseAuditFilters,
  parseAuditPage,
} from '../src/features/audit/url-state';

const params = (query: string) => new URLSearchParams(query);
const ACTOR = '11111111-2222-4333-8444-555555555555';

describe('audit filters in the URL', () => {
  it('reads every filter back out of a link', () => {
    expect(
      parseAuditFilters(params(`user=${ACTOR}&action=auth.login&from=2026-09-01&to=2026-09-30`)),
    ).toEqual({ user: ACTOR, action: 'auth.login', from: '2026-09-01', to: '2026-09-30' });
  });

  it('drops an actor that is not an id rather than forwarding it to the API', () => {
    expect(parseAuditFilters(params('user=not-a-uuid')).user).toBe('');
  });

  // A malformed date reaches the API as a 400, so an auditor following a mangled link would get an
  // error page instead of an empty result.
  it('drops a malformed date', () => {
    expect(parseAuditFilters(params('from=last-tuesday')).from).toBe('');
    expect(parseAuditFilters(params('to=2026-13-01')).to).toBe('');
  });

  // The shape check alone passes this; `new Date` would silently roll it forward to 3 March and
  // shift the window the auditor believes they are looking at.
  it('drops a date that looks right but does not exist', () => {
    expect(parseAuditFilters(params('from=2026-02-31')).from).toBe('');
  });

  it('keeps an action name this build does not know about', () => {
    expect(parseAuditFilters(params('action=document.something-added-later')).action).toBe(
      'document.something-added-later',
    );
  });

  it('rejects an action name that could not have been recorded', () => {
    expect(parseAuditFilters(params('action=<script>')).action).toBe('');
  });

  it('falls back to page one for anything that is not a page number', () => {
    expect(parseAuditPage(params('page=abc'))).toBe(1);
    expect(parseAuditPage(params('page=0'))).toBe(1);
    expect(parseAuditPage(params('page=3'))).toBe(3);
  });

  it('omits defaults so an unfiltered trail is reached with no query at all', () => {
    expect(auditFiltersToParams({ user: '', action: '', from: '', to: '' }, 1)).toBe('');
  });

  it('round-trips filters through the URL unchanged', () => {
    const filters = { user: ACTOR, action: 'user.created', from: '2026-09-01', to: '2026-09-30' };
    expect(parseAuditFilters(params(auditFiltersToParams(filters, 2)))).toEqual(filters);
    expect(parseAuditPage(params(auditFiltersToParams(filters, 2)))).toBe(2);
  });

  it('offers Clear only when something is actually narrowing the trail', () => {
    expect(hasActiveAuditFilters({ user: '', action: '', from: '', to: '' })).toBe(false);
    expect(hasActiveAuditFilters({ user: '', action: '', from: '2026-09-01', to: '' })).toBe(true);
  });
});

describe('the audit query sent to the API', () => {
  /*
   * The one translation that can silently mislead: the server's upper bound is exclusive, so a `to`
   * of 30 September sent verbatim would drop everything that happened on the 30th — while still
   * showing the auditor a filter that says they are looking at it.
   */
  it('turns the chosen end date into the start of the following day', () => {
    const query = params(auditQueryString({ user: '', action: '', from: '', to: '2026-09-30' }, 1));
    expect(query.get('to')).toBe('2026-10-01T00:00:00.000Z');
  });

  it('crosses a month boundary correctly', () => {
    const query = params(auditQueryString({ user: '', action: '', from: '', to: '2026-02-28' }, 1));
    expect(query.get('to')).toBe('2026-03-01T00:00:00.000Z');
  });

  it('sends the chosen start date as the inclusive lower bound it already is', () => {
    const query = params(auditQueryString({ user: '', action: '', from: '2026-09-01', to: '' }, 1));
    expect(query.get('from')).toBe('2026-09-01T00:00:00.000Z');
  });

  it('turns a page number into limit and offset', () => {
    const query = params(auditQueryString({ user: '', action: '', from: '', to: '' }, 3));
    expect(query.get('limit')).toBe(String(AUDIT_PAGE_SIZE));
    expect(query.get('offset')).toBe(String(AUDIT_PAGE_SIZE * 2));
  });

  it('omits a filter that is not set', () => {
    const query = params(auditQueryString({ user: '', action: '', from: '', to: '' }, 1));
    expect(query.has('user')).toBe(false);
    expect(query.has('action')).toBe(false);
    expect(query.has('from')).toBe(false);
    expect(query.has('to')).toBe(false);
  });
});

describe('action names', () => {
  it('reads a stored name as a sentence', () => {
    expect(auditActionLabel('document.workflow.request_revision')).toBe(
      'Document workflow · request revision',
    );
    expect(auditActionLabel('auth.login')).toBe('Auth · login');
    expect(auditActionLabel('document.routing-slip-exported')).toBe(
      'Document · routing slip exported',
    );
  });

  it('renders an unrecognised name as itself rather than as nothing', () => {
    expect(auditActionLabel('somethingnew')).toBe('somethingnew');
  });
});
