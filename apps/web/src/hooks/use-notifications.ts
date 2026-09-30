'use client';

import { useCallback, useEffect, useState } from 'react';
import { connectRealtime } from '../lib/realtime';
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from '../lib/notifications';

export interface UseNotifications {
  items: Notification[];
  unreadCount: number;
  live: boolean;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

/**
 * Owns the notification inbox: an initial fetch, a realtime subscription that refetches on each
 * server ping, and optimistic read-state updates. Disabled (and cleared) while signed out, so it
 * never calls the API without a session.
 */
export const useNotifications = (enabled: boolean): UseNotifications => {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    const page = await fetchNotifications();
    setItems(page.items);
    setUnreadCount(page.unreadCount);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setUnreadCount(0);
      setLive(false);
      return;
    }
    void refresh().catch(() => undefined);
    const disconnect = connectRealtime({
      onNotification: () => void refresh().catch(() => undefined),
      onConnectionChange: setLive,
    });
    return () => {
      disconnect();
      setLive(false);
    };
  }, [enabled, refresh]);

  const markRead = useCallback(async (id: string) => {
    // Optimistic: flip the row and decrement the badge, then persist.
    setItems((current) =>
      current.map((item) =>
        item.id === id && item.readAt === null
          ? { ...item, readAt: new Date().toISOString() }
          : item,
      ),
    );
    setUnreadCount((count) => Math.max(0, count - 1));
    await markNotificationRead(id);
  }, []);

  const markAllRead = useCallback(async () => {
    const readAt = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt })));
    setUnreadCount(0);
    await markAllNotificationsRead();
  }, []);

  return { items, unreadCount, live, refresh, markRead, markAllRead };
};
