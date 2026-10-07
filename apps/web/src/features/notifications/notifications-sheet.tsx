'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Inbox } from 'lucide-react';
import { toast } from 'sonner';
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
import { cn } from '@/lib/utils';
import {
  relativeTime,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type Notification,
} from './queries';

/**
 * The notification inbox, opened from the bell in the sidebar footer (or the topbar, below lg).
 *
 * A sheet rather than a route: it is read beside whatever the user is doing, and sending them to
 * a separate page to check a badge would lose their place. The badge is always mounted, because
 * the count is the point — the sheet's contents are only fetched once it is opened.
 */
export function NotificationsSheet({
  live,
  placement = 'topbar',
  className,
}: Readonly<{
  live: boolean;
  /**
   * Where the bell sits. In the sidebar footer it takes the sidebar's colours and marks unread
   * with a seal dot; in the narrow-screen topbar it keeps the count.
   */
  placement?: 'topbar' | 'sidebar';
  className?: string;
}>) {
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
          size="icon"
          className={cn(
            'relative',
            placement === 'sidebar' &&
              'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent',
            className,
          )}
          aria-label={unreadCount === 0 ? 'Notifications' : `Notifications, ${unreadCount} unread`}
        >
          <Bell />
          {unreadCount === 0 ? null : placement === 'sidebar' ? (
            <span
              className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-sidebar-seal ring-2 ring-sidebar"
              aria-hidden
            />
          ) : (
            <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white tabular-nums dark:text-background">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent className="flex w-full flex-col gap-0 bg-card p-0 sm:max-w-[440px]">
        <SheetHeader className="gap-1 border-b border-border p-5 pr-16">
          <SheetTitle className="font-display text-[28px] leading-tight font-normal">
            Notifications
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular-nums">{unreadCount.toLocaleString()} unread</span>
            {/*
              The live dot distinguishes "nothing has happened" from "this tab stopped listening",
              which otherwise look identical and lead people to trust a stale inbox.
            */}
            <span className="flex items-center gap-1.5 text-xs">
              <span
                className={
                  live ? 'size-2 rounded-full bg-primary' : 'size-2 rounded-full bg-border'
                }
                aria-hidden
              />
              {live ? 'Live' : 'Offline'}
            </span>
            {unreadCount > 0 ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="ml-auto h-11 px-0"
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
          </div>
          <SheetDescription>
            Assignments and workflow actions on documents in your scope.
          </SheetDescription>
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
            <ul className="divide-y divide-border-subtle">
              {items.map((notification) => {
                const unread = notification.readAt === null;
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => openDocument(notification)}
                      className={cn(
                        'flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                        unread && 'bg-accent',
                      )}
                    >
                      {/* Filled for unread, a ring for read: the state reads without colour. */}
                      <span
                        className={cn(
                          'mt-1.5 size-2.5 shrink-0 rounded-full',
                          unread ? 'bg-primary' : 'border-[1.5px] border-muted-foreground',
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-[15px] text-foreground',
                              unread ? 'font-bold' : 'font-medium',
                            )}
                          >
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
                        {unread ? <span className="sr-only">Unread</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
