'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  downloadMonthlyReport,
  fetchMonthlyReport,
  MONTH_NAMES,
  type MonthlyReport,
} from '../lib/reports';

const now = new Date();

export function ReportsView() {
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setReport(await fetchMonthlyReport(year, month));
    } catch (cause) {
      setReport(null);
      setError(cause instanceof Error ? cause.message : 'Unable to load the report');
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (format: 'xlsx' | 'pdf') => {
    setError('');
    try {
      await downloadMonthlyReport(format, year, month);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Download failed');
    }
  };

  const years = Array.from({ length: 6 }, (_, index) => now.getUTCFullYear() - index);

  return (
    <div className="reports-view">
      <div className="reports-toolbar">
        <label className="control">
          <span>Month</span>
          <select value={month} onChange={(event) => setMonth(Number(event.target.value))}>
            {MONTH_NAMES.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="control">
          <span>Year</span>
          <select value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <div className="reports-downloads">
          <button type="button" className="secondary" onClick={() => void download('xlsx')}>
            ↓ XLSX
          </button>
          <button type="button" className="secondary" onClick={() => void download('pdf')}>
            ↓ PDF
          </button>
        </div>
      </div>

      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}

      {loading ? (
        <p className="muted">Loading report…</p>
      ) : report ? (
        <>
          <section className="metrics">
            <article>
              <span>Total</span>
              <strong>{report.totals.total}</strong>
              <small>Registered this month</small>
            </article>
            <article>
              <span>Incoming</span>
              <strong>{report.totals.incoming}</strong>
              <small>Received</small>
            </article>
            <article>
              <span>Outgoing</span>
              <strong>{report.totals.outgoing}</strong>
              <small>Released</small>
            </article>
            <article>
              <span>FOI / Special orders</span>
              <strong>
                {report.totals.foiRequests} / {report.totals.specialOrders}
              </strong>
              <small>By type</small>
            </article>
          </section>

          <div className="document-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Monthly report</p>
                <h2>
                  {MONTH_NAMES[report.month - 1]} {report.year}{' '}
                  <span>{report.documents.length}</span>
                </h2>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Type</th>
                    <th>Direction</th>
                    <th>Reference</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {report.documents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        No documents registered in this period.
                      </td>
                    </tr>
                  ) : (
                    report.documents.map((doc) => (
                      <tr key={doc.id}>
                        <td>
                          <strong>{doc.title}</strong>
                          {doc.sender && <small>{doc.sender}</small>}
                        </td>
                        <td>{doc.type.replaceAll('_', ' ')}</td>
                        <td>{doc.direction === 'INCOMING' ? '↘ Incoming' : '↗ Outgoing'}</td>
                        <td>{doc.referenceNumber ?? '—'}</td>
                        <td>{new Date(doc.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
