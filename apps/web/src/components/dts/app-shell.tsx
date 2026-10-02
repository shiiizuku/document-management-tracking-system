'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { CommandPalette } from '@/features/command-palette/command-palette';
import { NotificationsSheet } from '@/features/notifications/notifications-sheet';
import { useRealtimeSync } from '@/features/realtime/use-realtime-sync';
import { useLogout, useSession, type SessionUser } from '@/features/session/queries';
import { cn, enumLabel } from '@/lib/utils';
import { isNavItemActive, navSections } from './nav-items';

/**
 * The frame every signed-in screen renders inside: brand, primary navigation, and the account
 * menu. Mounted once by the `(app)` layout, so a route is only ever its own content.
 *
 * The same nav renders twice — in the permanent sidebar on a wide screen and inside a sheet on a
 * narrow one — from one `SidebarNav` below, so the two cannot drift apart.
 *
 * It is also where realtime is mounted. One socket for the whole signed-in app: a subscription
 * per screen would open and close a connection on every navigation, and two subscriptions would
 * invalidate the same queries twice per event.
 */
export function AppShell({ user, children }: Readonly<{ user: SessionUser; children: ReactNode }>) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const realtime = useRealtimeSync();

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card/95 px-4 backdrop-blur lg:px-8">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              {/* Radix requires an accessible title on every dialog; the brand below is the
                  visible heading, so this one is for assistive technology only. */}
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              {/* Closing on navigate is the whole reason this takes a callback: without it the
                  sheet stays open over the route the user just chose. */}
              <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
            </SheetContent>
          </Sheet>

          <span className="font-serif text-base lg:hidden">Document Tracking System</span>

          <div className="ml-auto flex items-center gap-1">
            {/*
              The palette lives here, beside the other topbar controls, because its trigger is how
              the ⌘K shortcut is discovered at all — mounting it invisibly would be the undiscoverable
              shortcut D-99 rules out. It is in the shell rather than a route for the same reason
              realtime is: one key listener for the whole signed-in app.
            */}
            <CommandPalette />
            <NotificationsSheet live={realtime.connected} />
            <AccountMenu user={user} />
          </div>
        </header>

        <main className="min-w-0 flex-1 space-y-6 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex h-14 items-center gap-3 border-b border-border px-4">
      <span
        className="flex size-8 items-center justify-center rounded-md bg-primary font-serif text-sm text-primary-foreground ring-1 ring-gold/60"
        aria-hidden
      >
        D
      </span>
      <span className="font-serif text-sm leading-tight">
        Document
        <br />
        Tracking System
      </span>
    </div>
  );
}

/**
 * The capability-filtered nav. Reads the session itself rather than taking the items as a prop:
 * it renders in two places, and threading an identical list through both callers only creates a
 * way for them to differ.
 */
function SidebarNav({ onNavigate = () => undefined }: Readonly<{ onNavigate?: () => void }>) {
  const pathname = usePathname();
  const { can } = useSession();
  const sections = navSections(can);

  return (
    <nav aria-label="Primary" className="flex-1 space-y-4 p-3">
      {sections.map((group) => (
        <div key={group.section ?? 'workspace'} className="space-y-1">
          {/*
            The heading comes from the grouping, so a group with nothing visible in it never renders
            one — an administrator sees "Administration", and everyone else sees no sign that it is
            there.
          */}
          {group.section === undefined ? null : (
            <p className="px-3 pb-1 text-[10px] font-bold tracking-[0.12em] text-muted-foreground uppercase">
              {group.section}
            </p>
          )}
          {group.items.map((item) => {
            const active = isNavItemActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  active
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <item.icon className="size-4" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function AccountMenu({ user }: Readonly<{ user: SessionUser }>) {
  const logout = useLogout();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-2">
          <Avatar className="size-7">
            <AvatarFallback className="bg-secondary text-xs text-secondary-foreground">
              {initials(user.displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm sm:inline">{user.displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm">{user.displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          <span className="mt-1 block text-xs text-muted-foreground">{enumLabel(user.role)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={logout.isPending}
          onSelect={() => logout.mutate()}
        >
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Up to two initials from a display name, for the avatar fallback. */
const initials = (displayName: string): string =>
  displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
