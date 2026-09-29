import type {
  AuthorizationActor,
  AuthorizationPolicy,
  AuthorizationResource,
} from '../authorization/authorization.policy.js';

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

export const sanitizeSpreadsheetCell = (value: string): string =>
  spreadsheetFormulaPrefix.test(value) ? `'${value}` : value;

export class MonthlyReportService {
  constructor(private readonly authorization: AuthorizationPolicy) {}

  calculate(
    actor: AuthorizationActor,
    documents: readonly ReportDocument[],
    year: number,
    month: number,
  ): MonthlyReport {
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      throw new Error('A valid report month and year are required');
    }

    const start = Date.UTC(year, month - 1, 1);
    const end = Date.UTC(year, month, 1);
    const scoped = this.authorization.filterReadable(actor, documents).filter((document) => {
      const createdAt = document.createdAt.getTime();
      return createdAt >= start && createdAt < end;
    });

    return {
      year,
      month,
      totals: {
        incoming: scoped.filter((document) => document.direction === 'INCOMING').length,
        outgoing: scoped.filter((document) => document.direction === 'OUTGOING').length,
        foiRequests: scoped.filter((document) => document.type === 'FOI_REQUEST').length,
        specialOrders: scoped.filter((document) => document.type === 'SPECIAL_ORDER').length,
        total: scoped.length,
      },
      documents: scoped,
    };
  }
}
