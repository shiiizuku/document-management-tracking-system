'use client';

import { relativeTime, type Notification } from '../lib/notifications';

interface NotificationsPanelProps {
  items: Notification[];
  unreadCount: number;
  live: boolean;
  onClose: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onOpenDocument?: (documentId: string) => void;
}

export function NotificationsPanel({
  items,
  unreadCount,
  live,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onOpenDocument,
}: NotificationsPanelProps) {
  return (
    <div className="notif-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="notif-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="notif-head">
          <div>
            <p className="eyebrow">
              Inbox
              <span
                className={live ? 'notif-live on' : 'notif-live'}
                title={live ? 'Live' : 'Offline'}
              >
                {live ? 'Live' : 'Offline'}
              </span>
            </p>
            <h2 id="notif-title">Notifications {unreadCount > 0 && <b>{unreadCount}</b>}</h2>
          </div>
          <div className="notif-head-actions">
            <button
              type="button"
              className="secondary"
              onClick={onMarkAllRead}
              disabled={unreadCount === 0}
            >
              Mark all read
            </button>
            <button
              type="button"
              className="icon"
              aria-label="Close notifications"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>
        <ul className="notif-list">
          {items.length === 0 ? (
            <li className="notif-empty">You’re all caught up.</li>
          ) : (
            items.map((item) => (
              <li key={item.id} className={item.readAt ? 'notif-item' : 'notif-item unread'}>
                <button
                  type="button"
                  className="notif-item-main"
                  onClick={() => {
                    if (item.readAt === null) onMarkRead(item.id);
                    if (item.documentId && onOpenDocument) onOpenDocument(item.documentId);
                  }}
                >
                  <span className="notif-dot" aria-hidden />
                  <span className="notif-body">
                    <strong>{item.title}</strong>
                    <span>{item.body}</span>
                    <small>{relativeTime(item.createdAt)}</small>
                  </span>
                </button>
                {item.readAt === null && (
                  <button
                    type="button"
                    className="notif-read"
                    onClick={() => onMarkRead(item.id)}
                    aria-label={`Mark “${item.title}” as read`}
                  >
                    Mark read
                  </button>
                )}
              </li>
            ))
          )}
        </ul>
      </aside>
    </div>
  );
}
