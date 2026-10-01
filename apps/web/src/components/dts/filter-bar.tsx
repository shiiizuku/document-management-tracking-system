'use client';

import type { FormEvent, ReactNode } from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  hasOtherActiveFilters = false,
}: FilterBarProps) {
  const anySelectActive = selects.some((select) => (values[select.id] ?? '') !== '');
  const canClear = anySelectActive || hasOtherActiveFilters || (search?.value ?? '') !== '';

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    search?.onSubmit();
  };

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
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
            <Label htmlFor={`filter-${select.id}`} className="mb-1.5 text-xs text-muted-foreground">
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

      {canClear ? (
        <Button type="button" variant="ghost" onClick={onClear}>
          <X aria-hidden />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
