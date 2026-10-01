import { FileSpreadsheet, FileText, type LucideIcon } from 'lucide-react';
import type { Capability } from '@dts/contracts';

/**
 * The primary navigation, and the rules for showing and highlighting it.
 *
 * Kept as data in a plain module rather than as markup inside the sidebar for two reasons: the
 * gating and matching rules below are the part worth testing, and they are testable here without
 * a router or a rendered tree; and adding a route in a later phase is then a one-line change in
 * one place.
 */
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Hide this item unless the signed-in user holds this capability. Omitted where every
   * authenticated user may enter — the API still scopes what they find inside.
   */
  capability?: Capability;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/reports', label: 'Reports', icon: FileSpreadsheet, capability: 'REPORT_VIEW' },
  // F2 adds /dashboard, /my-work, /audit and the /admin group here, each with its capability.
];

/**
 * The items this user should see.
 *
 * Gating is a courtesy — the API enforces the same capabilities — but a nav item leading to a
 * screen whose every request will be refused is worse than no item at all. `can` fails closed
 * while the session loads, so nothing appears before authority is known.
 */
export const visibleNavItems = (can: (capability: Capability) => boolean): NavItem[] =>
  NAV_ITEMS.filter((item) => item.capability === undefined || can(item.capability));

/**
 * Whether a nav item is the one currently open.
 *
 * Prefix matching, so `/documents/abc123` keeps "Documents" highlighted — but on a path boundary,
 * so a future `/documents-archive` would not. Exact-match alone would unhighlight the whole
 * sidebar as soon as the user opened a record.
 */
export const isNavItemActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);
