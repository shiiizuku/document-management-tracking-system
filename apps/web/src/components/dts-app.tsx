'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { useNotifications } from '../hooks/use-notifications';
import { NotificationsPanel } from './notifications-panel';
import { StatusBadge } from './status-badge';

type User = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  divisionId: string | null;
};
type DocumentItem = {
  id: string;
  title: string;
  trackingNumber: string;
  referenceNumber: string | null;
  status: string;
  priority: string;
  type: string;
  direction: string;
  sender: string | null;
  company: string | null;
  divisionId: string;
  sectionId: string | null;
  createdAt: string;
  version: number;
};
type Detail = DocumentItem & {
  description: string | null;
  timeline: Array<{
    id: string;
    action: string;
    fromStatus: string;
    toStatus: string;
    remarks: string | null;
    occurredAt: string;
  }>;
  allowedActions: string[];
};
const actionLabels: Record<string, string> = {
  ACCEPT: 'Accept & begin',
  REQUEST_REVISION: 'Request revision',
  RESUBMIT: 'Resubmit',
  SUBMIT_FOR_SIGNATURE: 'Submit for signature',
  SIGN: 'Record signature',
  PREPARE_RELEASE: 'Prepare release',
  RELEASE: 'Release document',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore',
};

export function DtsApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Detail | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const notifications = useNotifications(user !== null);

  const refreshDocuments = useCallback(async (term = '') => {
    const result = await api<{ items: DocumentItem[]; total: number }>(
      `/documents?pageSize=50&search=${encodeURIComponent(term)}`,
    );
    setDocuments(result.items);
    setTotal(result.total);
  }, []);
  const loadDetail = useCallback(async (id: string) => {
    setSelected(await api<Detail>(`/documents/${id}`));
  }, []);

  useEffect(() => {
    void api<User>('/auth/me')
      .then(async (me) => {
        setUser(me);
        await refreshDocuments();
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [refreshDocuments]);

  const metrics = useMemo(
    () => ({
      pending: documents.filter((d) => d.status === 'PENDING').length,
      active: documents.filter((d) => !['RELEASED', 'ARCHIVED'].includes(d.status)).length,
      completed: documents.filter((d) => ['RELEASED', 'ARCHIVED'].includes(d.status)).length,
    }),
    [documents],
  );

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const me = await api<User>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
      });
      setUser(me);
      await refreshDocuments();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Login failed');
    }
  }

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const rawDirection = form.get('direction');
    const direction = rawDirection === 'OUTGOING' ? 'OUTGOING' : 'INCOMING';
    try {
      const created = await api<DocumentItem>('/documents', {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          type: form.get('type'),
          description: form.get('description'),
          priority: form.get('priority'),
          direction,
          sender: direction === 'INCOMING' ? form.get('sender') : undefined,
          company: form.get('company') || undefined,
          referenceNumber: form.get('referenceNumber') || undefined,
          divisionId: user?.divisionId ?? 'division-records',
          sectionId: user?.divisionId === 'division-pilot' ? 'section-pilot' : 'section-intake',
        }),
      });
      setShowCreate(false);
      await refreshDocuments(search);
      await loadDetail(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create document');
    }
  }

  async function runAction(action: string) {
    if (!selected) return;
    let remarks: string | undefined;
    let releaseMethod: string | undefined;
    if (action === 'REQUEST_REVISION')
      remarks = window.prompt('Revision remarks (required):') ?? undefined;
    if (action === 'RELEASE')
      releaseMethod =
        window.prompt('Delivery method: MAILED, EMAILED, PICKED_UP, or DELIVERED', 'EMAILED') ??
        undefined;
    try {
      await api(`/documents/${selected.id}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify({ expectedVersion: selected.version, remarks, releaseMethod }),
      });
      await Promise.all([loadDetail(selected.id), refreshDocuments(search)]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Action failed');
    }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
    setSelected(null);
    setShowNotifications(false);
  }

  if (loading)
    return (
      <main className="center-screen">
        <div className="loader" aria-label="Loading" />
      </main>
    );
  if (!user)
    return (
      <main className="login-shell">
        <section className="login-story">
          <div className="seal">DTS</div>
          <p className="eyebrow">Government records operations</p>
          <h1>
            Every document.
            <br />
            Every handoff.
            <br />
            <em>Accounted for.</em>
          </h1>
          <p>
            Secure registration, routing, review, release, and archival—one authoritative timeline
            from intake to completion.
          </p>
          <div className="trust-row">
            <span>Immutable versions</span>
            <span>Scoped access</span>
            <span>Audited actions</span>
          </div>
        </section>
        <section className="login-panel">
          <form onSubmit={login} className="login-form">
            <p className="eyebrow">Authorized access</p>
            <h2>Sign in to the DTS</h2>
            <p className="muted">Use your organization-issued account.</p>
            {error && (
              <div className="alert" role="alert">
                {error}
              </div>
            )}
            <label>
              Email
              <input
                name="email"
                type="email"
                defaultValue="records@dts.local"
                required
                autoComplete="username"
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                defaultValue="Records@1234!"
                required
                autoComplete="current-password"
              />
            </label>
            <button className="primary" type="submit">
              Sign in <span aria-hidden>→</span>
            </button>
            <p className="fineprint">Access is monitored and recorded in the audit trail.</p>
          </form>
        </section>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div>
            <strong>
              Document
              <br />
              Tracking System
            </strong>
          </div>
        </div>
        <nav aria-label="Primary">
          <button className="nav-active">
            <span>◫</span> Workspace
          </button>
          <button
            className={showNotifications ? 'nav-active' : ''}
            onClick={() => setShowNotifications(true)}
          >
            <span>◎</span> Notifications{' '}
            {notifications.unreadCount > 0 && <b>{notifications.unreadCount}</b>}
          </button>
          <button>
            <span>▤</span> Reports
          </button>
          <button>
            <span>⌕</span> Audit trail
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{user.displayName.slice(0, 2).toUpperCase()}</div>
          <div>
            <strong>{user.displayName}</strong>
            <small>{user.role.replaceAll('_', ' ')}</small>
          </div>
          <button onClick={() => void logout()} title="Sign out">
            ↗
          </button>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Operational workspace</p>
            <h1>Good day, {user.displayName.split(' ')[0]}</h1>
          </div>
          <button className="primary compact" onClick={() => setShowCreate(true)}>
            + Register document
          </button>
        </header>
        {error && (
          <div className="alert" role="alert">
            <button onClick={() => setError('')}>×</button>
            {error}
          </div>
        )}
        <section className="metrics">
          <article>
            <span>Pending intake</span>
            <strong>{metrics.pending}</strong>
            <small>Awaiting acceptance</small>
          </article>
          <article>
            <span>Active work</span>
            <strong>{metrics.active}</strong>
            <small>Across your authorized scope</small>
          </article>
          <article>
            <span>Released / archived</span>
            <strong>{metrics.completed}</strong>
            <small>Completed records</small>
          </article>
          <article className="attention">
            <span>Unread notices</span>
            <strong>{notifications.unreadCount}</strong>
            <small>Assignments and actions</small>
          </article>
        </section>
        <section className="content-grid">
          <div className="document-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Registry</p>
                <h2>
                  Documents <span>{total}</span>
                </h2>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void refreshDocuments(search);
                }}
              >
                <input
                  aria-label="Search documents"
                  placeholder="Search title, number, sender…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button type="submit">Search</button>
              </form>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Document</th>
                    <th>Status</th>
                    <th>Priority</th>
                    <th>Direction</th>
                    <th>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty">
                        No accessible documents found.
                      </td>
                    </tr>
                  ) : (
                    documents.map((document) => (
                      <tr
                        key={document.id}
                        onClick={() => void loadDetail(document.id)}
                        className={selected?.id === document.id ? 'selected' : ''}
                      >
                        <td>
                          <strong>{document.title}</strong>
                          <small>
                            {document.trackingNumber}
                            {document.referenceNumber ? ` · ${document.referenceNumber}` : ''}
                          </small>
                        </td>
                        <td>
                          <StatusBadge status={document.status} />
                        </td>
                        <td>
                          <span className={`priority priority-${document.priority.toLowerCase()}`}>
                            {document.priority}
                          </span>
                        </td>
                        <td>{document.direction === 'INCOMING' ? '↘ Incoming' : '↗ Outgoing'}</td>
                        <td>{new Date(document.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <aside className="detail-panel">
            {selected ? (
              <>
                <div className="detail-head">
                  <p className="eyebrow">{selected.trackingNumber}</p>
                  <button onClick={() => setSelected(null)}>×</button>
                  <h2>{selected.title}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <dl>
                  <div>
                    <dt>Direction</dt>
                    <dd>{selected.direction}</dd>
                  </div>
                  <div>
                    <dt>Priority</dt>
                    <dd>{selected.priority}</dd>
                  </div>
                  <div>
                    <dt>Sender</dt>
                    <dd>{selected.sender ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Reference</dt>
                    <dd>{selected.referenceNumber ?? '—'}</dd>
                  </div>
                </dl>
                <div className="actions">
                  {selected.allowedActions.map((action) => (
                    <button
                      key={action}
                      className={action === 'REQUEST_REVISION' ? 'secondary danger' : 'secondary'}
                      onClick={() => void runAction(action)}
                    >
                      {actionLabels[action] ?? action}
                    </button>
                  ))}
                </div>
                <div className="timeline">
                  <h3>Timeline</h3>
                  {selected.timeline.length === 0 ? (
                    <p className="muted">No workflow actions yet.</p>
                  ) : (
                    selected.timeline.map((event) => (
                      <article key={event.id}>
                        <i />
                        <div>
                          <strong>{actionLabels[event.action] ?? event.action}</strong>
                          <small>{new Date(event.occurredAt).toLocaleString()}</small>
                          {event.remarks && <p>{event.remarks}</p>}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="detail-empty">
                <span>↗</span>
                <h3>Select a document</h3>
                <p>Review metadata, allowed actions, and its complete timeline.</p>
              </div>
            )}
          </aside>
        </section>
      </main>
      {showCreate && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowCreate(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="register-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <p className="eyebrow">New registry entry</p>
                <h2 id="register-title">Register document</h2>
              </div>
              <button onClick={() => setShowCreate(false)}>×</button>
            </div>
            <form onSubmit={createDocument} className="document-form">
              <label className="span-2">
                Title
                <input name="title" required maxLength={240} />
              </label>
              <label>
                Direction
                <select name="direction">
                  <option value="INCOMING">Incoming</option>
                  <option value="OUTGOING">Outgoing</option>
                </select>
              </label>
              <label>
                Priority
                <select name="priority">
                  <option>NORMAL</option>
                  <option>HIGH</option>
                  <option>URGENT</option>
                  <option>LOW</option>
                </select>
              </label>
              <label>
                Type
                <select name="type">
                  <option value="MEMORANDUM">Memorandum</option>
                  <option value="FOI_REQUEST">FOI request</option>
                  <option value="SPECIAL_ORDER">Special order</option>
                  <option value="LETTER">Letter</option>
                </select>
              </label>
              <label>
                Sender
                <input name="sender" />
              </label>
              <label>
                Company / agency
                <input name="company" />
              </label>
              <label>
                External reference
                <input name="referenceNumber" />
              </label>
              <label className="span-2">
                Description
                <textarea name="description" rows={4} />
              </label>
              <div className="form-actions span-2">
                <button type="button" className="secondary" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="primary">
                  Register document
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
      {showNotifications && (
        <NotificationsPanel
          items={notifications.items}
          unreadCount={notifications.unreadCount}
          live={notifications.live}
          onClose={() => setShowNotifications(false)}
          onMarkRead={(id) => void notifications.markRead(id)}
          onMarkAllRead={() => void notifications.markAllRead()}
          onOpenDocument={(id) => {
            setShowNotifications(false);
            void loadDetail(id);
          }}
        />
      )}
    </div>
  );
}
