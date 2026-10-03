'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/**
 * Radix refuses an empty string as a `SelectItem` value — it reserves it for "nothing selected" —
 * but "no filter" is a real, selectable choice here. The sentinel exists only inside this file:
 * callers hand over and receive `''` for an inactive filter, and never learn this string exists.
 */
const ANY = '__any__';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterSelectSpec {
  /** Key into `values`, and what `onChange` reports back. */
  id: string;
  label: string;
  options: readonly FilterOption[];
  /** The wording for the no-filter choice, e.g. "Any status". */
  anyLabel: string;
}

export interface FilterBarProps {
  /**
   * Free-text search. Separate from the selects because it behaves differently: it is applied on
   * submit rather than per keystroke, so typing does not fire a request per character.
   */
  search?: {
    value: string;
    placeholder: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
  };
  selects?: readonly FilterSelectSpec[];
  /** Current value per select id; `''` means the filter is not applied. */
  values?: Readonly<Record<string, string>>;
  onSelectChange?: (id: string, value: string) => void;
  /** Clears every filter this bar owns, including the search box. */
  onClear: () => void;
  /** Extra controls for one screen only — the audit view's date range, for instance. */
  children?: ReactNode;
  /**
   * Controls that belong beside the bar rather than inside its panel, pinned to the end of the
   * header row. The document lists' view control lives here: it is not a filter — it changes
   * nothing about which records are listed — but it is the other thing you reach for above a list,
   * and giving it a row of its own would push the list down for one button.
   */
  trailing?: ReactNode;
  /**
   * Set when a filter this bar does not own is active, so Clear still offers itself. Without it,
   * a screen with its own date inputs could end up filtered with no visible way back.
   */
  hasOtherActiveFilters?: boolean;
}

/**
 * The filter row above a list: a search box, a set of single-choice dropdowns, and a Clear
 * affordance that appears only when something is actually filtered.
 *
 * It holds no state. Filter state lives in the URL on every screen that uses this (so a filtered
 * view can be linked, reloaded and reached with the back button), and a component with its own
 * copy would immediately disagree with the URL on the first back-navigation. What it does own is
 * the part each screen would otherwise get subtly wrong: that selects apply immediately while
 * search waits for submit, that "no filter" is a selectable option rather than a blank row, and
 * when Clear is worth showing.
 */
export function FilterBar({
  search,
  selects = [],
  values = {},
  onSelectChange,
  onClear,
  children,
  trailing,
  hasOtherActiveFilters = false,
}: FilterBarProps) {
  const activeCount =
    selects.filter((select) => (values[select.id] ?? '') !== '').length +
    ((search?.value ?? '') !== '' ? 1 : 0) +
    (hasOtherActiveFilters ? 1 : 0);
  const canClear = activeCount > 0;

  /*
   * Collapsed by default, because the list is the screen and six dropdowns above it are not.
   *
   * Opened on mount when something is already filtered, which is the case that matters: the
   * Archive nav item is `/documents?status=ARCHIVED`, and arriving there to a collapsed panel
   * would show a filtered list with no visible reason for it. `useState` initialiser rather than
   * an effect, so it is the panel's first render that is already open rather than a second one —
   * and it is deliberately NOT kept in sync afterwards, since re-opening the panel every time a
   * filter changes would fight the user who just closed it.
   */
  const [open, setOpen] = useState(activeCount > 0);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search?.onSubmit();
  };

  return (
    <CollapsiblePrimitive.Root
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex flex-wrap items-center gap-2 p-2">
        <CollapsiblePrimitive.Trigger asChild>
          <Button type="button" variant="ghost" size="sm" className="gap-2">
            <SlidersHorizontal aria-hidden />
            Advanced search
            {activeCount > 0 && (
              <span
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-secondary px-1.5 text-label-small font-bold text-secondary-foreground"
                /* The count is already in the button's text for a screen reader, below. */
                aria-hidden
              >
                {activeCount}
              </span>
            )}
            <span className="sr-only">
              {activeCount === 0
                ? ''
                : `, ${String(activeCount)} filter${activeCount === 1 ? '' : 's'} active`}
            </span>
            <ChevronDown
              className={cn(
                'transition-transform duration-(--md-duration-short-2) ease-standard',
                open && 'rotate-180',
              )}
              aria-hidden
            />
          </Button>
        </CollapsiblePrimitive.Trigger>

        {/*
          Clear sits in the header, not inside the panel. It is the control someone wants precisely
          when the panel is shut and they can see a filtered list without seeing why.
        */}
        {canClear ? (
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            <X aria-hidden />
            Clear
          </Button>
        ) : null}

        {trailing === undefined ? null : <div className="ml-auto">{trailing}</div>}
      </div>

      <CollapsiblePrimitive.Content
        className={cn(
          'overflow-hidden',
          'data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up',
        )}
      >
        <div className="flex flex-wrap items-end gap-3 border-t border-border p-3">
          {search ? (
            <form onSubmit={submitSearch} className="flex min-w-60 flex-1 items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="filter-search" className="mb-1.5 text-xs text-muted-foreground">
                  Search
                </Label>
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    id="filter-search"
                    type="search"
                    value={search.value}
                    placeholder={search.placeholder}
                    onChange={(event) => search.onChange(event.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              <Button type="submit" variant="secondary">
                Search
              </Button>
            </form>
          ) : null}

          {selects.map((select) => {
            const current = values[select.id] ?? '';
            return (
              <div key={select.id} className="min-w-40">
                <Label
                  htmlFor={`filter-${select.id}`}
                  className="mb-1.5 text-xs text-muted-foreground"
                >
                  {select.label}
                </Label>
                <Select
                  value={current === '' ? ANY : current}
                  onValueChange={(value) => onSelectChange?.(select.id, value === ANY ? '' : value)}
                >
                  <SelectTrigger id={`filter-${select.id}`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ANY}>{select.anyLabel}</SelectItem>
                    {select.options.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}

          {children}
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}
