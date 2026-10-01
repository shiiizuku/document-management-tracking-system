'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/dts/empty-state';
import {
  relativeTime,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type Notification,
} from './queries';

/**
 * The notification inbox, opened from the app bar.
 *
 * A sheet rather than a route: it is read beside whatever the user is doing, and sending them to
 * a separate page to check a badge would lose their place. The badge is always mounted, because
 * the count is the point — the sheet's contents are only fetched once it is opened.
 */
export function NotificationsSheet({ live }: Readonly<{ live: boolean }>) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Mounted closed on every screen, so the inbox is fetched for the badge but not paged; the
  // query is the same one the open sheet reads, so opening it costs nothing.
  const inbox = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const unreadCount = inbox.data?.unreadCount ?? 0;
  const items = inbox.data?.items ?? [];

  const openDocument = (notification: Notification) => {
    if (notification.readAt === null) markRead.mutate(notification.id);
    if (notification.documentId === null) return;
    setOpen(false);
    router.push(`/documents/${notification.documentId}`);
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unreadCount === 0 ? 'Notifications' : `Notifications, ${unreadCount} unread`}
        >
          <Bell />
          {unreadCount > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white tabular-nums">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
      </SheetTrigger>

      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle>Notifications</SheetTitle>
            {/*
              The live dot distinguishes "nothing has happened" from "this tab stopped listening",
              which otherwise look identical and lead people to trust a stale inbox.
            */}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={
                  live ? 'size-2 rounded-full bg-primary' : 'size-2 rounded-full bg-border'
                }
                aria-hidden
              />
              {live ? 'Live' : 'Offline'}
            </span>
          </div>
          <SheetDescription>
            Assignments and workflow actions on documents in your scope.
          </SheetDescription>
          {unreadCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={markAllRead.isPending}
              onClick={() =>
                markAllRead.mutate(undefined, {
                  onError: () =>
                    toast.error('Could not mark everything read', {
                      description: 'Your inbox has been restored. Please try again.',
                    }),
                })
              }
            >
              <CheckCheck />
              Mark all read
            </Button>
          ) : null}
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {inbox.isPending ? (
            <div className="space-y-3 p-4" aria-hidden>
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : inbox.error !== null ? (
            <p className="p-4 text-sm text-destructive">
              {inbox.error instanceof Error
                ? inbox.error.message
                : 'Your notifications could not be loaded.'}
            </p>
          ) : items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nothing yet"
              description="You will be notified here when a document is assigned to you or moves through the workflow."
              className="m-4"
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    onClick={() => openDocument(notification)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <span
                      className={
                        notification.readAt === null
                          ? 'mt-1.5 size-2 shrink-0 rounded-full bg-primary'
                          : 'mt-1.5 size-2 shrink-0 rounded-full bg-transparent'
                      }
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {notification.title}
                        </span>
                        <time
                          dateTime={notification.createdAt}
                          className="shrink-0 text-xs text-muted-foreground"
                        >
                          {relativeTime(notification.createdAt)}
                        </time>
                      </span>
                      <span className="mt-0.5 block text-sm text-muted-foreground">
                        {notification.body}
                      </span>
                      {notification.readAt === null ? (
                        <Badge variant="outline" className="mt-1.5">
                          Unread
                        </Badge>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
