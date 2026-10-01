'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * The notification inbox — the durable record of what happened to the user's documents.
 *
 * Toasts are immediate feedback and disappear; this is the copy that survives a closed tab
 * (decision D-111). That is why mark-read is optimistic but never fire-and-forget: the badge has
 * to react to the click, and it also has to go back up if the server did not accept it, or the
 * user is left believing they have read something that is still waiting.
 */

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

const notificationKeys = {
  inbox: ['notifications'] as const,
};

export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.inbox,
    queryFn: () => api<NotificationPage>('/notifications'),
  });
}

/**
 * Refetches the inbox. Called by the realtime adapter on a server ping, which is why it is a
 * plain function over the client rather than a hook: the adapter has an event handler, not a
 * render.
 */
export function invalidateNotifications(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: notificationKeys.inbox });
}

/**
 * Applies a change to the cached inbox and returns the page as it was, so a failed mutation can
 * put it back. Kept in one place because both mark-read paths need exactly the same rollback.
 */
const patchInbox = (
  client: QueryClient,
  change: (page: NotificationPage) => NotificationPage,
): NotificationPage | undefined => {
  const previous = client.getQueryData<NotificationPage>(notificationKeys.inbox);
  if (previous !== undefined) client.setQueryData(notificationKeys.inbox, change(previous));
  return previous;
};

export function useMarkNotificationRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<Notification | null>(`/notifications/${id}/read`, { method: 'POST' }),

    onMutate: (id) => {
      // Cancel an in-flight refetch first: a response that left the server before this edit would
      // land after it and silently restore the unread state.
      void client.cancelQueries({ queryKey: notificationKeys.inbox });
      const readAt = new Date().toISOString();
      const previous = patchInbox(client, (page) => ({
        ...page,
        items: page.items.map((item) =>
          item.id === id && item.readAt === null ? { ...item, readAt } : item,
        ),
        // Only decrement if this row really was unread, so a double click cannot take the badge
        // below the truth.
        unreadCount:
          page.items.find((item) => item.id === id)?.readAt === null
            ? Math.max(0, page.unreadCount - 1)
            : page.unreadCount,
      }));
      return { previous };
    },

    onError: (_error, _id, context) => {
      if (context?.previous !== undefined)
        client.setQueryData(notificationKeys.inbox, context.previous);
    },

    // Reconcile with the server either way: the optimistic edit was a guess at one field, and the
    // authoritative count may also have moved for reasons this client never saw.
    onSettled: () => invalidateNotifications(client),
  });
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api<{ marked: number }>('/notifications/read-all', { method: 'POST' }),

    onMutate: () => {
      void client.cancelQueries({ queryKey: notificationKeys.inbox });
      const readAt = new Date().toISOString();
      const previous = patchInbox(client, (page) => ({
        ...page,
        items: page.items.map((item) => (item.readAt === null ? { ...item, readAt } : item)),
        unreadCount: 0,
      }));
      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined)
        client.setQueryData(notificationKeys.inbox, context.previous);
    },

    onSettled: () => invalidateNotifications(client),
  });
}

/**
 * A compact, locale-independent relative time ("just now", "5m ago", "3d ago"), falling back to a
 * date once "weeks ago" stops being useful. Pure, with the clock injected, so the inbox renders
 * deterministically in a test.
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
