'use client';

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { KeyRound, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react';
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
import {
  CommandPalette,
  PaletteTrigger,
  useChordLabel,
} from '@/features/command-palette/command-palette';
import { NotificationsSheet } from '@/features/notifications/notifications-sheet';
import { ColorModeButton, ThemePicker } from '@/components/theme-toggle';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDivisions } from '@/features/org/queries';
import { useRealtimeSync } from '@/features/realtime/use-realtime-sync';
import { ChangePasswordDialog } from '@/features/session/change-password-dialog';
import { useLogout, useSession, type SessionUser } from '@/features/session/queries';
import { cn, enumLabel } from '@/lib/utils';
import { activeNavHref, navSections, visibleNavItems } from './nav-items';

/**
 * The frame every signed-in screen renders inside: brand, search, primary navigation, and the
 * account, theme and notification controls in the sidebar footer. Mounted once by the `(app)`
 * layout, so a route is only ever its own content.
 *
 * Civic Ledger moves everything into the sidebar. On a wide screen with the sidebar expanded there
 * is no topbar at all; below `lg` the sidebar becomes the sheet behind a slim topbar's menu button,
 * and that topbar carries the two things a phone user needs without opening it — search and the
 * bell. The account menu is in the sheet's footer there, so it is never mounted twice.
 *
 * Collapsing the wide-screen sidebar (its toggle, or Ctrl/⌘B) leaves no room for a search field in
 * a 64px rail, so search moves out of it into a top bar across the content column. There is only
 * ever one search entry point on screen: the sidebar's while expanded, the top bar's while
 * collapsed.
 *
 * The same nav renders twice — in the permanent sidebar and inside the sheet — from one
 * `SidebarNav` below, so the two cannot drift apart.
 *
 * It is also where realtime and the command palette are mounted. One socket for the whole
 * signed-in app: a subscription per screen would open and close a connection on every navigation.
 * One palette, opened by whichever Search button is on screen: two palettes would each answer ⌘K.
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

/** Tailwind's `lg` breakpoint, the width from which the permanent sidebar is shown. */
const DESKTOP_QUERY = '(min-width: 64rem)';

const subscribeDesktop = (onChange: () => void) => {
  const media = typeof window.matchMedia === 'function' ? window.matchMedia(DESKTOP_QUERY) : null;
  media?.addEventListener('change', onChange);
  return () => media?.removeEventListener('change', onChange);
};
const desktopNow = () =>
  typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_QUERY).matches;

/**
 * Whether the viewport is at `lg` or wider, where the permanent sidebar (and so its collapsed
 * state) exists. False on the server and in a browser without `matchMedia`: the sidebar then keeps
 * its own Search button, which is the safe side — search is never missing, at worst it is in the
 * rail.
 */
function useDesktopViewport(): boolean {
  return useSyncExternalStore(subscribeDesktop, desktopNow, () => false);
}

/**
 * Whether a key press is someone typing — in a field, a select, or an editable region — where
 * Ctrl/⌘B belongs to the text (bold, in a rich editor) and not to the shell.
 */
const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  ((target instanceof HTMLElement && target.isContentEditable) ||
    target.closest(
      'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
    ) !== null);

/**
 * Ctrl/⌘B toggles the sidebar — the chord most sidebar apps use. Only at `lg` and up, where there
 * is a sidebar to collapse; below that the chord is left to the browser. Shift and Alt variants
 * are left alone, and it never touches K, so the palette's chord is unaffected.
 */
function useSidebarShortcut(toggle: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'b' || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey || event.repeat || event.isComposing) return;
      if (event.defaultPrevented || isTextEntry(event.target) || !desktopNow()) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);
}

export function AppShell({ user, children }: Readonly<{ user: SessionUser; children: ReactNode }>) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  useSidebarShortcut(toggleCollapsed);
  const desktop = useDesktopViewport();
  // Collapsed on a wide screen, search lives in the top bar instead of the rail.
  const searchInTopbar = collapsed && desktop;
  const toggleChord = useChordLabel('B');
  const toggleLabel = collapsed ? 'Expand the sidebar' : 'Collapse the sidebar';
  const realtime = useRealtimeSync();
  const openPalette = () => setPaletteOpen(true);

  return (
    <div data-slot="app-shell" className="flex min-h-screen bg-background">
      <aside
        data-slot="app-sidebar"
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-sidebar-edge bg-sidebar text-sidebar-foreground lg:flex',
          'transition-[width] duration-200 ease-in-out motion-reduce:transition-none',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Focus order follows the handoff: brand, Search, nav, then the footer controls. */}
        <Brand collapsed={collapsed} />
        {searchInTopbar ? null : <SidebarSearch collapsed={collapsed} onOpen={openPalette} />}
        <SidebarNav collapsed={collapsed} />
        <SidebarFooter user={user} collapsed={collapsed} live={realtime.connected} />
        <div
          className={cn(
            'border-t border-sidebar-avatar px-2 py-1.5',
            collapsed ? 'flex justify-center' : 'flex justify-end',
          )}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleCollapsed}
                aria-label={toggleLabel}
                aria-expanded={!collapsed}
                aria-keyshortcuts="Control+B Meta+B"
                className="text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              >
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {toggleLabel}
              <kbd className="ml-2 rounded border border-background/30 px-1 font-sans text-[10px] font-semibold">
                {toggleChord}
              </kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          Wide screen, sidebar collapsed: the search the rail has no room for, as a field across
          the top of the content column, aligned with the page content beneath it. Gated on the
          viewport in script and also hidden below `lg` in CSS, so it can never sit beside the
          narrow topbar.
        */}
        {searchInTopbar ? (
          <header
            data-slot="app-desktop-topbar"
            className="sticky top-0 z-20 hidden h-14 shrink-0 border-b border-border bg-card lg:block"
          >
            <div className="mx-auto flex h-full w-full max-w-[1280px] items-center px-4 sm:px-6">
              <PaletteTrigger placement="field" onClick={openPalette} />
            </div>
          </header>
        ) : null}

        <header
          data-slot="app-topbar"
          className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b border-border bg-card/95 px-2 backdrop-blur sm:px-4 lg:hidden"
        >
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 gap-0 border-r-0 bg-sidebar p-0 text-sidebar-foreground [&>button:last-child]:bg-sidebar-accent [&>button:last-child]:text-sidebar-foreground"
            >
              {/* Radix requires an accessible title on every dialog; the brand below is the
                  visible heading, so this one is for assistive technology only. */}
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Brand />
              <SidebarSearch
                onOpen={() => {
                  setMobileNavOpen(false);
                  openPalette();
                }}
              />
              {/* Closing on navigate is the whole reason this takes a callback: without it the
                  sheet stays open over the route the user just chose. */}
              <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
              <SidebarFooter user={user} live={realtime.connected} showBell={false} />
            </SheetContent>
          </Sheet>

          <span className="min-w-0 shrink truncate font-display text-lg sm:text-xl">
            Document Tracking
          </span>

          {/*
            The palette is the app's search, so its trigger is shaped and placed like one. It is
            also where the ⌘K chord is written down on a narrow screen — mounting the palette
            invisibly would be the undiscoverable shortcut D-99 rules out.
          */}
          <div className="flex min-w-0 flex-1 justify-end sm:justify-center">
            <PaletteTrigger onClick={openPalette} className="hidden sm:flex" />
            <Button
              variant="ghost"
              size="icon"
              className="sm:hidden"
              aria-label="Open the command palette"
              onClick={openPalette}
            >
              <Search />
            </Button>
          </div>

          <NotificationsSheet live={realtime.connected} />
        </header>

        <main
          data-slot="app-main"
          className="mx-auto w-full max-w-[1280px] min-w-0 flex-1 space-y-6 px-4 py-8 sm:px-6"
        >
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} showTrigger={false} />
    </div>
  );
}

/**
 * The product mark: a seal ring with "DTS" set in the display face, then the product name and the
 * office. Drawn rather than the bureau's raster logo, because the seal has to take each theme's
 * sidebar colours, and a fixed-colour image on a plate read as a sticker on the dark Civic bar.
 */
function Brand({ collapsed = false }: Readonly<{ collapsed?: boolean }>) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center pt-5 pb-4',
        collapsed ? 'justify-center px-2' : 'gap-3 px-4',
      )}
    >
      <span
        className="flex size-[38px] shrink-0 items-center justify-center rounded-full border-2 border-sidebar-seal font-display text-[13px] tracking-wider text-sidebar-seal"
        aria-hidden={!collapsed}
        role={collapsed ? 'img' : undefined}
        aria-label={collapsed ? 'Document Tracking System' : undefined}
      >
        DTS
      </span>
      {collapsed ? null : (
        <span className="min-w-0">
          <span className="block truncate font-display text-lg leading-tight">
            Document Tracking
          </span>
          <span
            className="block truncate text-xs text-sidebar-muted-foreground"
            title="Mines and Geosciences Bureau"
          >
            Mines and Geosciences Bureau
          </span>
        </span>
      )}
    </div>
  );
}

/** The Search button: the sidebar's way into the command palette. */
function SidebarSearch({
  collapsed = false,
  onOpen,
}: Readonly<{ collapsed?: boolean; onOpen: () => void }>) {
  if (!collapsed) {
    return (
      <div className="px-3 pb-3">
        <PaletteTrigger placement="sidebar" onClick={onOpen} />
      </div>
    );
  }
  return (
    <div className="flex justify-center px-2 pb-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={onOpen}
            aria-label="Open the command palette"
            className="border border-sidebar-border bg-sidebar-accent text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <Search />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Search</TooltipContent>
      </Tooltip>
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
    <nav
      data-slot="app-navigation"
      aria-label="Primary"
      className={cn('flex-1 space-y-5 overflow-y-auto pb-4', collapsed ? 'px-2' : 'px-3')}
    >
      {sections.map((group) => (
        <div key={group.section ?? 'workspace'} className="space-y-1">
          {/*
            The heading comes from the grouping, so a group with nothing visible in it never renders
            one — an administrator sees "Administration", and everyone else sees no sign that it is
            there. Collapsed, a rule stands in for it: the grouping is still information, and three
            unexplained icons running into four is worse than a 1px line.
          */}
          {group.section === undefined ? null : collapsed ? (
            <hr className="mx-2 border-t border-sidebar-border" aria-hidden />
          ) : (
            <p className="px-3 pb-1 text-[11px] font-bold tracking-[0.12em] text-sidebar-muted-foreground uppercase">
              {group.section}
            </p>
          )}
          {group.items.map((item) => {
            const isCurrent = active === item.href;
            /*
             * The current item is marked three ways — fill, weight and an underline in the theme's
             * accent — so the underline is never the only signal, and `aria-current` says it to a
             * screen reader.
             */
            const link = (
              <Link
                data-slot="navigation-link"
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-[10px] text-[15px]',
                  'transition-colors duration-150 ease-in-out',
                  'focus-visible:ring-2 focus-visible:ring-sidebar-seal focus-visible:outline-none',
                  collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                  isCurrent
                    ? 'bg-sidebar-accent font-semibold text-sidebar-foreground'
                    : 'text-sidebar-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                )}
              >
                <item.icon className="size-[18px] shrink-0" aria-hidden />
                {collapsed ? (
                  <span className="sr-only">{item.label}</span>
                ) : (
                  <span
                    className={cn(
                      'truncate',
                      isCurrent &&
                        'underline decoration-sidebar-primary decoration-[3px] underline-offset-[7px]',
                    )}
                  >
                    {item.label}
                  </span>
                )}
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

/**
 * Who is signed in, and the per-person controls: theme, notifications and colour mode.
 *
 * Expanded, the account is its own row (a 256px sidebar cannot fit a name beside three 44px
 * buttons without truncating every name to nothing), with the three controls in a row beneath it.
 * Collapsed, all four stack as icons.
 */
function SidebarFooter({
  user,
  live,
  collapsed = false,
  showBell = true,
}: Readonly<{ user: SessionUser; live: boolean; collapsed?: boolean; showBell?: boolean }>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn(
        'shrink-0 border-t border-sidebar-avatar',
        collapsed ? 'flex flex-col items-center gap-1 px-2 py-2' : 'space-y-1 px-3 py-3',
      )}
    >
      <AccountMenu user={user} collapsed={collapsed} />
      <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
        <ThemePicker collapsed={collapsed} />
        {showBell ? <NotificationsSheet live={live} placement="sidebar" /> : null}
        <ColorModeButton tooltipSide={collapsed ? 'right' : 'top'} />
      </div>
    </div>
  );
}

function AccountMenu({
  user,
  collapsed = false,
}: Readonly<{ user: SessionUser; collapsed?: boolean }>) {
  const logout = useLogout();
  const [changingPassword, setChangingPassword] = useState(false);
  const division = useDivisionName(user.divisionId);
  const role = enumLabel(user.role);
  const placement = division === null ? role : `${role} · ${division}`;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={collapsed ? user.displayName : undefined}
            className={cn(
              'flex min-h-11 items-center gap-3 rounded-[10px] text-left',
              'hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-seal focus-visible:outline-none data-[state=open]:bg-sidebar-accent',
              collapsed ? 'justify-center p-1' : 'w-full px-1.5 py-1',
            )}
          >
            <Avatar className="size-9">
              <AvatarFallback className="bg-sidebar-avatar text-xs font-semibold text-sidebar-foreground">
                {initials(user.displayName)}
              </AvatarFallback>
            </Avatar>
            {collapsed ? null : (
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold" title={user.displayName}>
                  {user.displayName}
                </span>
                <span
                  className="block truncate text-xs text-sidebar-muted-foreground"
                  title={placement}
                >
                  {placement}
                </span>
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-56">
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm">{user.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            <span className="mt-1 block text-xs text-muted-foreground">{role}</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChangingPassword(true)}>
            <KeyRound />
            Change password
          </DropdownMenuItem>
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
      <ChangePasswordDialog open={changingPassword} onOpenChange={setChangingPassword} />
    </>
  );
}

/**
 * The name of the user's division, for the footer's "Role · Division" line. The session carries
 * only the id; the name comes from the division list, which the registry and the admin screens
 * already cache under the same key. Null while it loads, for an unplaced user, or when the list is
 * unavailable — the line then shows the role alone rather than an id.
 */
function useDivisionName(divisionId: string | null): string | null {
  const divisions = useDivisions();
  if (divisionId === null || !Array.isArray(divisions.data)) return null;
  return divisions.data.find((division) => division.id === divisionId)?.name ?? null;
}

/** Up to two initials from a display name, for the avatar fallback. */
const initials = (displayName: string): string =>
  displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || '?';
