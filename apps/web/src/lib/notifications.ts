import { api } from './api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  documentId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPage {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

export const fetchNotifications = (): Promise<NotificationPage> =>
  api<NotificationPage>('/notifications');

export const markNotificationRead = (id: string): Promise<Notification | null> =>
  api<Notification | null>(`/notifications/${id}/read`, { method: 'POST' });

export const markAllNotificationsRead = (): Promise<{ marked: number }> =>
  api<{ marked: number }>('/notifications/read-all', { method: 'POST' });

/**
 * A compact, locale-independent relative time ("just now", "5m ago", "3d ago"). Kept pure so the
 * inbox renders deterministically and it can be unit-tested without a clock library.
 */
export const relativeTime = (iso: string, now: number = Date.now()): string => {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(then).toLocaleDateString();
};
