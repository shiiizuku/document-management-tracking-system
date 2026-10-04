'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * How a document list draws its rows: as cards, as a table, or as one line each (decision 173).
 *
 * This applies to document lists on two screens and changes what a row is.
 *
 * Per device rather than per account: it is a comfort setting, and round-tripping
 * it through the API would mean a flash of the wrong layout on every cold load while /auth/me is
 * in flight.
 *
 * And deliberately **not in the URL**. The registry puts its filters there so a filtered view can
 * be sent to a colleague; a card-versus-table preference travelling with that link would overwrite
 * the recipient's own choice the moment they opened it.
 */

export const LIST_VIEWS = [
  { id: 'card', label: 'Cards', note: 'One panel per document' },
  { id: 'table', label: 'Table', note: 'Columns, sortable' },
  { id: 'line', label: 'Lines', note: 'One row per document, tightest' },
] as const;

export type ListView = (typeof LIST_VIEWS)[number]['id'];

/** The table, because it is the view the columns were designed for and the only sortable one. */
export const DEFAULT_LIST_VIEW: ListView = 'table';

export const LIST_VIEW_STORAGE_KEY = 'dts.listView';

export function isListView(value: unknown): value is ListView {
  return LIST_VIEWS.some((view) => view.id === value);
}

/**
 * Reads the stored choice, validating rather than trusting it.
 *
 * The stored value is attacker-adjacent — anything with console access can write it — and it is
 * about to pick a renderer. It is also just robust: a value written by an older build whose view
 * has since been renamed falls back to the default instead of rendering nothing.
 */
export function readListView(): ListView {
  if (typeof window === 'undefined') return DEFAULT_LIST_VIEW;
  try {
    const raw = window.localStorage.getItem(LIST_VIEW_STORAGE_KEY);
    return isListView(raw) ? raw : DEFAULT_LIST_VIEW;
  } catch {
    return DEFAULT_LIST_VIEW;
  }
}

/**
 * The current list view and the one way to change it.
 *
 * **No boot script**, which is the difference from the theme. The theme is painted by the server
 * and so has to be corrected before the first frame or the user sees a flash of the wrong colours.
 * These lists are client-fetched and paint a skeleton before any row exists, so reading
 * `localStorage` on mount lands the choice well before there is anything laid out to flash — and
 * seeding state from storage during render would be a hydration mismatch for nothing.
 */
export function useListView(): { view: ListView; setView: (next: ListView) => void } {
  const [view, setViewState] = useState<ListView>(DEFAULT_LIST_VIEW);

  useEffect(() => {
    setViewState(readListView());
  }, []);

  const setView = useCallback((next: ListView) => {
    setViewState(next);
    try {
      window.localStorage.setItem(LIST_VIEW_STORAGE_KEY, next);
    } catch {
      // A window that refuses storage still gets the choice for the rest of this session.
    }
  }, []);

  return { view, setView };
}
