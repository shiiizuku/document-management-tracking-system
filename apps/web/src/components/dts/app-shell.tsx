'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LogOut, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
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
import { AppearanceBar } from '@/components/md3/appearance-bar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useRealtimeSync } from '@/features/realtime/use-realtime-sync';
import { useLogout, useSession, type SessionUser } from '@/features/session/queries';
import { cn, enumLabel } from '@/lib/utils';
import { activeNavHref, navSections, visibleNavItems } from './nav-items';

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
const SIDEBAR_STORAGE_KEY = 'dts.sidebar-collapsed';

/**
 * Whether the sidebar is collapsed to its icon rail, remembered per device.
 *
 * Seeded `false` and corrected on mount rather than read during render: the server cannot read
 * localStorage, so reading it in the initial state would render different markup on the two sides.
 * The cost of being briefly wrong here is one frame at the wrong width, which is why this does not
 * get the blocking boot script the theme needs — a flash of the wrong WIDTH is a layout detail, a
 * flash of the wrong COLOUR is the whole page.
 */
function useSidebarCollapsed(): readonly [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1');
    } catch {
      // A window that refuses storage simply starts expanded every time.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* the choice still holds for this session */
      }
      return next;
    });
  }, []);

  return [collapsed, toggle] as const;
}

export function AppShell({ user, children }: Readonly<{ user: SessionUser; children: ReactNode }>) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  const realtime = useRealtimeSync();

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-border bg-card lg:flex',
          'transition-[width] duration-(--md-duration-medium-2) ease-emphasized',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        <Brand collapsed={collapsed} />
        <SidebarNav collapsed={collapsed} />
        {/*
          Appearance sits at the foot of the navigation rather than in the topbar: the topbar is
          for what you are doing to the record in front of you, and a theme is not that. Density
          stays one click away inside the palette for the clerk who retunes it mid-queue.
        */}
        <AppearanceBar collapsed={collapsed} />
        <div className={cn('border-t border-border p-2', collapsed && 'flex justify-center')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleCollapsed}
                aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
                aria-expanded={!collapsed}
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            </TooltipContent>
          </Tooltip>
        </div>
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
              <AppearanceBar />
            </SheetContent>
          </Sheet>

          {/*
            Three columns, so the search pill is centred on the HEADER rather than on whatever
            space is left beside it. The two flankers share `flex-1 basis-0`, so they stay equal as
            the account name changes length and the pill does not drift.
          */}
          <div className="flex min-w-0 flex-1 basis-0 items-center">
            <span className="truncate text-base font-semibold lg:hidden">
              Document Tracking System
            </span>
          </div>

          {/*
            The palette is the app's search, so its trigger is shaped and placed like one. It is
            also the only place the ⌘K chord is written down — mounting the palette invisibly would
            be the undiscoverable shortcut D-99 rules out. It is in the shell rather than a route
            for the same reason realtime is: one key listener for the whole signed-in app.
          */}
          <div className="flex min-w-0 flex-[2] justify-center">
            <CommandPalette />
          </div>

          <div className="flex flex-1 basis-0 items-center justify-end gap-1">
            <NotificationsSheet live={realtime.connected} />
            <AccountMenu user={user} />
          </div>
        </header>

        <main className="min-w-0 flex-1 space-y-section px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/**
 * The agency mark and the product name.
 *
 * The seal is a fixed-colour raster, so it is deliberately NOT tinted by the accent — an agency
 * mark recoloured to match a user's theme preference is no longer the mark. It sits on its own
 * neutral plate for the same reason: against `primary` at the Clay or Rose accent the seal's own
 * red and gold would read as a clash rather than as branding.
 *
 * `priority` because this is above the fold on every signed-in screen and is the one image in the
 * shell; without it Next defers it behind the route's own content and the sidebar flashes empty.
 */
function Brand({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center border-b border-border',
        collapsed ? 'justify-center px-2' : 'gap-3 px-4',
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-container-lowest ring-1 ring-outline-variant">
        <Image
          src="/branding/mgb-logo.png"
          alt="Mines and Geosciences Bureau"
          width={28}
          height={28}
          priority
          className="size-7 object-contain"
        />
      </span>
      {collapsed ? null : (
        <span className="truncate text-sm leading-tight font-semibold">
          Document
          <br />
          Tracking System
        </span>
      )}
    </div>
  );
}

/**
 * The capability-filtered nav. Reads the session itself rather than taking the items as a prop:
 * it renders in two places, and threading an identical list through both callers only creates a
 * way for them to differ.
 */
function SidebarNav({
  onNavigate = () => undefined,
  collapsed = false,
}: Readonly<{ onNavigate?: () => void; collapsed?: boolean }>) {
  const pathname = usePathname();
  const search = useSearchParams();
  const { can } = useSession();
  const sections = navSections(can);
  // Resolved once over the whole visible list, because which item is "current" depends on the
  // others: the registry and the archive share a path and are told apart by the query.
  const active = activeNavHref(
    pathname,
    new URLSearchParams(search.toString()),
    visibleNavItems(can),
  );

  return (
    <nav aria-label="Primary" className="flex-1 space-y-4 overflow-y-auto p-3">
      {sections.map((group) => (
        <div key={group.section ?? 'workspace'} className="space-y-1">
          {/*
            The heading comes from the grouping, so a group with nothing visible in it never renders
            one — an administrator sees "Administration", and everyone else sees no sign that it is
            there. Collapsed, a rule stands in for it: the grouping is still information, and three
            unexplained icons running into four is worse than a 1px line.
          */}
          {group.section === undefined ? null : collapsed ? (
            <hr className="mx-2 border-t border-border" aria-hidden />
          ) : (
            <p className="px-3 pb-1 text-label-small font-bold tracking-[0.12em] text-muted-foreground uppercase">
              {group.section}
            </p>
          )}
          {group.items.map((item) => {
            const isCurrent = active === item.href;
            const link = (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'md3-state-layer flex items-center rounded-md3-sm text-label-large font-medium',
                  'transition-colors duration-(--md-duration-short-2) ease-standard',
                  'h-control',
                  collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                  isCurrent
                    ? 'bg-secondary text-secondary-foreground'
                    : 'text-muted-foreground hover:text-accent-foreground',
                )}
              >
                <item.icon className="size-[1.125rem] shrink-0" aria-hidden />
                {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
              </Link>
            );

            // Collapsed, the label is the only thing identifying the icon, so it has to be
            // reachable by pointer as well as by screen reader.
            return collapsed ? (
              <Tooltip key={item.href}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ) : (
              link
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
