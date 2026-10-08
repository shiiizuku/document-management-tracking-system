'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
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

/**
 * An active filter this bar does not own — a date bound, the overdue flag — shown as a chip all
 * the same, so every narrowing of the list is visible and removable in one row.
 */
export interface FilterChipSpec {
  id: string;
  /** "Dates", "Overdue". */
  label: string;
  /** "Oct 1 – Oct 7, 2026". Omitted for a flag, whose chip is its label alone. */
  value?: string;
  onRemove: () => void;
}

export interface FilterBarProps {
  /**
   * Free-text search, in the bar's first row rather than the panel: it is the filter people reach
   * for first. Applied on submit (Enter) rather than per keystroke, so typing does not fire a
   * request per character.
   */
  search?: {
    value: string;
    placeholder: string;
    /** The search currently applied, as opposed to the draft being typed. Drives its chip. */
    applied: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    /** Clears the applied search, from its chip. */
    onClear: () => void;
  };
  selects?: readonly FilterSelectSpec[];
  /** Current value per select id; `''` means the filter is not applied. */
  values?: Readonly<Record<string, string>>;
  onSelectChange?: (id: string, value: string) => void;
  /** Chips for active filters the bar does not own (see {@link FilterChipSpec}). */
  extraChips?: readonly FilterChipSpec[];
  /** Clears every filter, the search included. */
  onClear: () => void;
  /** Extra controls inside the panel, after the selects — date inputs, a checkbox. */
  children?: ReactNode;
  /**
   * Controls that belong beside the bar rather than inside its panel, pinned to the end of the
   * chips row. The document lists' view control lives here: it is not a filter — it changes
   * nothing about which records are listed — but it is the other thing you reach for above a list.
   */
  trailing?: ReactNode;
  /**
   * Whether the list under the bar came back empty. Used once: an unfiltered list that is empty on
   * arrival opens the panel, since narrowing is not the problem and the filters are the next thing
   * to look at. Undefined while the list is loading.
   */
  emptyResult?: boolean | undefined;
}

/**
 * The filter card above a list (Civic Ledger "Advanced search"): an optional search box, an
 * Advanced search button with a count of what is active, a collapsible panel of dropdowns, and a
 * row of removable chips naming every active filter.
 *
 * It holds no filter state. Filter state lives in the URL on every screen that uses this (so a
 * filtered view can be linked, reloaded and reached with the back button), and a component with
 * its own copy would disagree with the URL on the first back-navigation. What it owns is the part
 * each screen would otherwise get subtly wrong: that selects apply immediately while search waits
 * for submit, that "no filter" is a selectable option rather than a blank row, and what counts as
 * an active filter — the badge and the chips are computed from the same list, so they cannot
 * disagree.
 *
 * The panel starts closed. The chips are what make that safe: a list that arrives filtered (the
 * Archive nav item is `/documents?status=ARCHIVED`) shows why in the chip row without the panel
 * having to be open.
 */
export function FilterBar({
  search,
  selects = [],
  values = {},
  onSelectChange,
  extraChips = [],
  onClear,
  children,
  trailing,
  emptyResult,
}: FilterBarProps) {
  const panelId = useId();
  const chipRowRef = useRef<HTMLDivElement>(null);

  const chips: FilterChipSpec[] = [
    ...(search !== undefined && search.applied.trim() !== ''
      ? [{ id: 'search', label: 'Search', value: search.applied.trim(), onRemove: search.onClear }]
      : []),
    ...selects.flatMap((select) => {
      const current = values[select.id] ?? '';
      if (current === '') return [];
      const option = select.options.find((candidate) => candidate.value === current);
      return [
        {
          id: select.id,
          label: select.label,
          value: option?.label ?? current,
          onRemove: () => onSelectChange?.(select.id, ''),
        },
      ];
    }),
    ...extraChips,
  ];
  const activeCount = chips.length;

  const [open, setOpen] = useState(false);

  // Opened at most once, and only for the case the handoff names: nothing filtered, nothing
  // listed. Re-opening on every later change would fight a user who just closed it.
  const autoOpened = useRef(false);
  useEffect(() => {
    if (autoOpened.current || emptyResult === undefined) return;
    autoOpened.current = true;
    if (emptyResult && activeCount === 0) setOpen(true);
  }, [emptyResult, activeCount]);

  /*
   * Removing a chip unmounts it, which would drop focus to <body>. Focus moves to the next chip
   * instead, or to "Clear all" when the removed one was last — and when nothing is left, to the
   * Advanced search button, which is the next control that still exists.
   */
  const removeChip = (index: number) => {
    chips[index]?.onRemove();
    requestAnimationFrame(() => {
      const row = chipRowRef.current;
      if (!row) return;
      const remaining = row.querySelectorAll<HTMLElement>('[data-chip-remove], [data-clear-all]');
      const target = remaining[Math.min(index, remaining.length - 1)];
      target?.focus();
    });
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search?.onSubmit();
  };

  const advancedButton = (
    <CollapsiblePrimitive.Trigger asChild>
      <Button
        type="button"
        variant="outline"
        aria-controls={panelId}
        className="gap-2 data-[state=open]:bg-muted"
      >
        <SlidersHorizontal aria-hidden />
        Advanced search
        {activeCount > 0 ? (
          <span
            data-slot="filter-count"
            className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground tabular-nums"
            // The count is read out in words below; the digit alone would be announced as "2".
            aria-hidden
          >
            {activeCount.toLocaleString()}
          </span>
        ) : null}
        <span className="sr-only">
          {activeCount === 0
            ? ''
            : `, ${String(activeCount)} filter${activeCount === 1 ? '' : 's'} active`}
        </span>
        <ChevronDown
          className={cn('transition-transform duration-150 ease-in-out', open && 'rotate-180')}
          aria-hidden
        />
      </Button>
    </CollapsiblePrimitive.Trigger>
  );

  const chipRow =
    activeCount === 0 ? null : (
      <div ref={chipRowRef} className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-foreground-secondary">Filtered by</span>
        <ul className="contents">
          {chips.map((chip, index) => (
            <li key={chip.id} className="contents">
              <span
                data-slot="filter-chip"
                className="inline-flex h-8 items-center gap-1 rounded-full border border-seal bg-seal-tint pr-1 pl-3 text-[13px] font-semibold text-seal-tint-foreground"
              >
                {chip.value === undefined ? chip.label : `${chip.label}: ${chip.value}`}
                <button
                  type="button"
                  data-chip-remove
                  onClick={() => removeChip(index)}
                  aria-label={
                    chip.value === undefined
                      ? `Remove filter ${chip.label}`
                      : `Remove filter ${chip.label}: ${chip.value}`
                  }
                  className="flex size-6 items-center justify-center rounded-full hover:bg-seal/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </span>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="link"
          size="sm"
          data-clear-all
          onClick={onClear}
          className="px-1"
        >
          Clear all
        </Button>
      </div>
    );

  return (
    <CollapsiblePrimitive.Root
      data-slot="filter-bar"
      open={open}
      onOpenChange={setOpen}
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      {search ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <form
              role="search"
              onSubmit={submitSearch}
              className="relative min-w-[min(320px,100%)] flex-1"
            >
              <Label htmlFor="filter-search" className="sr-only">
                Search
              </Label>
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="filter-search"
                type="search"
                fieldSize="filter"
                value={search.value}
                placeholder={search.placeholder}
                onChange={(event) => search.onChange(event.target.value)}
                className="pl-10"
              />
            </form>
            {advancedButton}
          </div>
          {chipRow === null && trailing === undefined ? null : (
            <div className="flex flex-wrap items-center gap-3">
              {chipRow}
              {trailing === undefined ? null : <div className="ml-auto">{trailing}</div>}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {chipRow}
          <div className="ml-auto flex items-center gap-3">
            {trailing}
            {advancedButton}
          </div>
        </div>
      )}

      <CollapsiblePrimitive.Content
        id={panelId}
        role="group"
        aria-label="Advanced search"
        className={cn(
          'overflow-hidden',
          'data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up',
        )}
      >
        <div className="space-y-4 border-t border-border pt-3.5">
          <div className="flex flex-wrap items-end gap-3">
            {selects.map((select) => {
              const current = values[select.id] ?? '';
              return (
                <div key={select.id} className="min-w-0 flex-[1_1_180px]">
                  <Label htmlFor={`filter-${select.id}`} className="mb-1.5">
                    {select.label}
                  </Label>
                  <Select
                    value={current === '' ? ANY : current}
                    onValueChange={(value) =>
                      onSelectChange?.(select.id, value === ANY ? '' : value)
                    }
                  >
                    <SelectTrigger
                      id={`filter-${select.id}`}
                      fieldSize="filter"
                      data-active={current === '' ? undefined : ''}
                      className="w-full data-[active]:border-seal data-[active]:bg-seal-tint"
                    >
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

          {/*
            Filters apply as they change (they are URL state), so neither button is needed to see
            a result: "Show results" only closes the panel, and "Reset filters" is Clear all said
            from inside it.
          */}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="link" size="sm" onClick={onClear}>
              Reset filters
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Show results
            </Button>
          </div>
        </div>
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  );
}

/** A labelled checkbox row for the panel — the registry's "Overdue only". 44px tall, 20px box. */
export function FilterCheckbox({
  id,
  label,
  checked,
  onChange,
}: Readonly<{
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}>) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-11 flex-[1_1_180px] cursor-pointer items-center gap-3 rounded-[10px] border-[1.5px] px-3.5 text-[15px]',
        checked ? 'border-seal bg-seal-tint' : 'border-input bg-card',
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-primary"
      />
      {label}
    </label>
  );
}
