import {
  Building2,
  FileSpreadsheet,
  FileText,
  Inbox,
  LayoutDashboard,
  ScrollText,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Capability } from '@dts/contracts';

/**
 * The primary navigation, and the rules for showing and highlighting it.
 *
 * Kept as data in a plain module rather than as markup inside the sidebar for two reasons: the
 * gating and matching rules below are the part worth testing, and they are testable here without
 * a router or a rendered tree; and adding a route is then a one-line change in one place.
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
  /**
   * The heading this item sits under. Omitted for the everyday screens, which need no heading
   * because they are the default — a lone "Workspace" label above the first four items would be
   * chrome explaining the obvious.
   */
  section?: string;
}

/** The heading the administrative routes sit under. One constant, so the group cannot split. */
export const ADMIN_SECTION = 'Administration';

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/my-work', label: 'My work', icon: Inbox },
  { href: '/reports', label: 'Reports', icon: FileSpreadsheet, capability: 'REPORT_VIEW' },
  {
    href: '/audit',
    label: 'Audit trail',
    icon: ScrollText,
    capability: 'AUDIT_VIEW',
    section: ADMIN_SECTION,
  },
  {
    href: '/admin/requests',
    label: 'Account requests',
    icon: UserPlus,
    capability: 'ACCOUNT_REQUEST_REVIEW',
    section: ADMIN_SECTION,
  },
  {
    href: '/admin/users',
    label: 'Users',
    icon: Users,
    capability: 'USER_MANAGE',
    section: ADMIN_SECTION,
  },
  {
    href: '/admin/organization',
    label: 'Organization',
    icon: Building2,
    capability: 'ORG_MANAGE',
    section: ADMIN_SECTION,
  },
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
 * The visible items grouped for rendering, in declaration order.
 *
 * Derived rather than stored as a nested structure, so the list above stays a flat table that
 * `visibleNavItems` and the active-route matcher can read without walking a tree. The important
 * property is that a group with no visible items disappears entirely: a user who holds `AUDIT_VIEW`
 * and nothing else must see one administrative item, not an empty "Administration" heading — which
 * is precisely what a hardcoded heading in the sidebar would produce.
 */
export const navSections = (
  can: (capability: Capability) => boolean,
): { section: string | undefined; items: NavItem[] }[] => {
  const groups: { section: string | undefined; items: NavItem[] }[] = [];
  for (const item of visibleNavItems(can)) {
    const last = groups.at(-1);
    if (last !== undefined && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
};

/**
 * Whether a nav item is the one currently open.
 *
 * Prefix matching, so `/documents/abc123` keeps "Documents" highlighted — but on a path boundary,
 * so a future `/documents-archive` would not. Exact-match alone would unhighlight the whole
 * sidebar as soon as the user opened a record.
 */
export const isNavItemActive = (pathname: string, href: string): boolean =>
  pathname === href || pathname.startsWith(`${href}/`);
