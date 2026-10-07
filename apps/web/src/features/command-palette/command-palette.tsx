'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { CornerDownLeft, Loader2, Search } from 'lucide-react';
import type { WorkflowAction } from '@dts/contracts';
import { Button } from '@/components/ui/button';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { visibleNavItems } from '@/components/dts/nav-items';
import { ACTION_LABELS } from '@/features/documents/action-labels';
import {
  DOCUMENT_SEARCH_MIN_LENGTH,
  useDocument,
  useDocumentSearch,
} from '@/features/documents/queries';
import { useActionRunner } from '@/features/documents/use-action-runner';
import { useSession } from '@/features/session/queries';
import { useDebounced } from '@/lib/use-debounced';
import { cn } from '@/lib/utils';

/**
 * The ⌘K command palette: jump to a document by tracking number, run an allowed action on the
 * document in view, or go to any destination the signed-in user may reach.
 *
 * Mounted once in the app shell, which is what lets it offer actions on the open document from
 * anywhere on the page — but it is also why it must assume no document: it renders on `/reports`
 * and `/admin/users` too. The open document is read from the path rather than passed down, so no
 * route has to know the palette exists.
 *
 * Three groups, in the order a user's intent narrows: what to do with the record in front of them,
 * which record to go to, then where in the app to go. Everything in all three is already gated —
 * `allowedActions` is the server's list, and the destinations come from the same
 * capability-filtered table the sidebar renders — so the palette cannot offer a shortcut to
 * something the UI would otherwise refuse to show.
 *
 * It is the app's only keyboard shortcut (D-99: discoverable and non-conflicting). The trigger in
 * the topbar prints the chord, which is the discoverability half; ⌘K/Ctrl+K is the half that has
 * to not collide, and it is the one chord users already expect to mean exactly this.
 */
export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: Readonly<{
  /**
   * Optional control from outside. The shell owns it so that two triggers — the sidebar's Search
   * button on a wide screen and the topbar's on a narrow one — open one palette with one key
   * listener; mounting the palette twice would make ⌘K open two dialogs at once.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Off when the caller places its own {@link PaletteTrigger}s. */
  showTrigger?: boolean;
}> = {}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  // Read by the ⌘K toggle, which is registered once and must see the current value, not the
  // value from the render that registered it.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const setOpen = useCallback(
    (next: boolean | ((was: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(openRef.current) : next;
      openRef.current = value;
      if (onOpenChange) onOpenChange(value);
      else setUncontrolledOpen(value);
    },
    [onOpenChange],
  );
  const [term, setTerm] = useState('');
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useSession();

  // The document whose actions the palette offers. `useDocument` is the detail screen's own query,
  // so on a document route this reads the cache the screen already filled rather than refetching.
  const documentId = openDocumentId(pathname);
  const openDocument = useDocument(documentId ?? '', documentId !== null);
  const document = documentId === null ? undefined : openDocument.data;
  const runner = useActionRunner(document);

  const search = useDocumentSearch(useDebounced(term), open);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey)) return;
      // Chrome binds Ctrl+K to its own search box; this is the one place the app takes a chord
      // from the browser, and only while the app has focus.
      event.preventDefault();
      setOpen((wasOpen) => !wasOpen);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setOpen]);

  /** Closes and clears, so the next ⌘K opens on a clean list rather than the last search. */
  const close = () => {
    setOpen(false);
    setTerm('');
  };

  const go = (href: string) => {
    close();
    router.push(href);
  };

  const runOnDocument = (action: WorkflowAction) => {
    // Closed first: an action that needs remarks opens its own dialog, and leaving the palette
    // over it would stack two modals the user has to dismiss in the right order.
    close();
    runner.start(action);
  };

  const trimmed = term.trim();
  const actions = document?.allowedActions ?? [];
  const matchedActions = actions.filter((action) => matches(ACTION_LABELS[action], trimmed));
  const destinations = visibleNavItems(can).filter((item) => matches(item.label, trimmed));
  const documents = trimmed.length >= DOCUMENT_SEARCH_MIN_LENGTH ? (search.data?.items ?? []) : [];
  const searching = search.isFetching && documents.length === 0;

  return (
    <>
      {showTrigger ? <PaletteTrigger onClick={() => setOpen(true)} /> : null}

      <CommandDialog
        open={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        title="Command palette"
        description="Search for a document by tracking number, run an action on the open document, or jump to a screen."
        /*
          cmdk's own fuzzy filter is off: the document rows are the server's answer to the same
          term, already scoped to what this user may read, and letting the client re-filter them
          would silently drop matches it scored badly. The two static groups are filtered below
          instead, by the same `matches` their lists are built from.
        */
        shouldFilter={false}
      >
        <CommandInput
          value={term}
          onValueChange={setTerm}
          placeholder="Search documents, actions and screens…"
        />
        <CommandList>
          <CommandEmpty>Nothing matches that.</CommandEmpty>

          {/*
            A status line rather than an entry in `CommandEmpty`: both of these are true while
            other groups still have items in them — a two-letter term matches destinations but is
            too short to search documents — and `CommandEmpty` renders only when the list is bare.
          */}
          {searching ? (
            <p
              role="status"
              className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Searching documents…
            </p>
          ) : trimmed.length > 0 && trimmed.length < DOCUMENT_SEARCH_MIN_LENGTH ? (
            <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
              {`Keep typing to search documents — ${DOCUMENT_SEARCH_MIN_LENGTH} characters or more.`}
            </p>
          ) : null}

          {matchedActions.length === 0 || document === undefined ? null : (
            <CommandGroup heading={`Actions on ${document.trackingNumber}`}>
              {matchedActions.map((action) => (
                <CommandItem
                  key={action}
                  value={`action-${action}`}
                  disabled={runner.isPending}
                  onSelect={() => runOnDocument(action)}
                >
                  <CornerDownLeft aria-hidden />
                  {ACTION_LABELS[action]}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {documents.length === 0 ? null : (
            <CommandGroup heading="Documents">
              {documents.map((item) => (
                <CommandItem
                  key={item.id}
                  value={`document-${item.id}`}
                  onSelect={() => go(`/documents/${item.id}`)}
                >
                  <span className="font-mono text-xs">{item.trackingNumber}</span>
                  <span className="truncate">{item.title}</span>
                  <CommandShortcut>
                    {item.status.replaceAll('_', ' ').toLowerCase()}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {trimmed.length === 0 ? null : (
            <CommandGroup heading="Registry">
              <CommandItem
                value="search-registry"
                onSelect={() => go(`/documents?search=${encodeURIComponent(trimmed)}`)}
              >
                <Search aria-hidden />
                {`Search the registry for “${trimmed}”`}
              </CommandItem>
            </CommandGroup>
          )}

          {destinations.length === 0 ? null : (
            <>
              <CommandSeparator />
              <CommandGroup heading="Go to">
                {destinations.map((item) => (
                  <CommandItem
                    key={item.href}
                    value={`nav-${item.href}`}
                    onSelect={() => go(item.href)}
                  >
                    <item.icon aria-hidden />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          )}
        </CommandList>
      </CommandDialog>

      {runner.dialog}
    </>
  );
}

/**
 * The visible way in, and the only place the shortcut is written down.
 *
 * A palette reachable only by a chord nobody told the user about is the shortcut D-99 forbids, so
 * this is a real button — it opens the palette on click, and reads the chord out to assistive
 * technology through its accessible name.
 */
export function PaletteTrigger({
  onClick,
  placement = 'topbar',
  className,
}: Readonly<{ onClick: () => void; placement?: 'topbar' | 'sidebar'; className?: string }>) {
  const chord = useChordLabel();

  // In the sidebar it is a full-width row above the nav, on the sidebar's own colours.
  if (placement === 'sidebar') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Open the command palette (${chord})`}
        className={cn(
          'flex min-h-11 w-full items-center gap-2.5 rounded-[10px] border border-sidebar-border bg-sidebar-accent px-3 text-left text-[15px] text-sidebar-muted-foreground',
          'transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-seal focus-visible:outline-none',
          className,
        )}
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="flex-1 truncate">Search</span>
        <kbd
          className="shrink-0 rounded-md border border-sidebar-border px-1.5 py-0.5 font-sans text-[11px] font-semibold"
          aria-hidden
        >
          {chord}
        </kbd>
      </button>
    );
  }

  return (
    /*
     * Shaped like the search field it stands in for rather than like a button, and sized to fill
     * the topbar's centre column: at this width it reads as the place you type, which is the
     * point — the palette IS the app's search, and a small button beside the notifications bell
     * does not say so.
     */
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      aria-label={`Open the command palette (${chord})`}
      className={cn(
        'h-11 w-full max-w-md justify-start gap-2 rounded-full border border-border px-4 font-normal text-muted-foreground hover:bg-accent',
        className,
      )}
    >
      <Search aria-hidden />
      <span className="flex-1 truncate text-left">Search documents and actions</span>
      <kbd
        className="hidden shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-sans text-[10px] font-semibold text-muted-foreground sm:inline"
        aria-hidden
      >
        {chord}
      </kbd>
    </Button>
  );
}

/**
 * How the chord is written on this machine — `⌘K` on a Mac, `Ctrl K` elsewhere.
 *
 * Resolved after mount rather than during render because the server has no platform to read, and
 * a guess baked into the HTML would be a hydration mismatch. The non-Mac form is the first paint,
 * so what a Mac user sees is a label that corrects itself, not a label that is missing.
 */
function useChordLabel(): string {
  const [onMac, setOnMac] = useState(false);

  useEffect(() => {
    setOnMac(/mac|iphone|ipad/i.test(window.navigator.userAgent));
  }, []);

  return onMac ? '⌘K' : 'Ctrl K';
}

/**
 * The document id in a detail path, or null anywhere else.
 *
 * Exported for its own test: the palette's action group appears or vanishes on this one string
 * comparison, and it must not fire on `/documents` itself or on a future `/documents/x/y`.
 */
export const openDocumentId = (pathname: string): string | null => {
  const segments = pathname.split('/').filter(Boolean);
  return segments.length === 2 && segments[0] === 'documents' ? (segments[1] ?? null) : null;
};

/** Case-insensitive substring match; an empty term matches everything, so a fresh palette is full. */
const matches = (label: string, term: string): boolean =>
  term === '' || label.toLowerCase().includes(term.toLowerCase());
