import type { AuthorizationResource } from '../authorization/authorization.policy.js';

/**
 * The shape of a monthly report, and the one piece of handling its exports cannot do without.
 *
 * This file used to export a `MonthlyReportService` whose `calculate` built the report from a set
 * of rows and re-checked each one against `AuthorizationPolicy.canRead`. Nothing ever called it:
 * `DocumentsService.monthlyReport` builds the report itself from rows already scoped in SQL by
 * `documentScopeFor`. It is gone rather than kept as a spare, because its second authorization
 * pass was a trap — it decided readability from a projection that carries no assignment or share
 * membership, so wiring it up would have silently dropped every document an actor reaches only by
 * being assigned it. Scope is settled in SQL; re-deciding it downstream can only ever disagree.
 */

export interface ReportDocument extends AuthorizationResource {
  title: string;
  referenceNumber: string | null;
  sender: string | null;
  company: string | null;
  type: string;
  direction: 'INCOMING' | 'OUTGOING';
  createdAt: Date;
}

export interface MonthlyReport {
  year: number;
  month: number;
  totals: {
    incoming: number;
    outgoing: number;
    foiRequests: number;
    specialOrders: number;
    total: number;
  };
  documents: ReportDocument[];
}

const spreadsheetFormulaPrefix = /^[\t\r\n ]*[=+\-@]/;

/**
 * Neutralizes a value a spreadsheet would otherwise execute.
 *
 * Every cell in the XLSX export carries text somebody typed into the registry, and a leading
 * `=`, `+`, `-` or `@` makes Excel treat it as a formula on open — which is a code-execution
 * path out of a document title. Prefixing an apostrophe forces it to a literal; the value is
 * unchanged for anything that does not start that way.
 */
export const sanitizeSpreadsheetCell = (value: string): string =>
  spreadsheetFormulaPrefix.test(value) ? `'${value}` : value;
