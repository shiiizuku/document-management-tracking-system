import {
  Archive,
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
    /*
     * The archive (policy register P-09). A filtered registry rather than a route of its own:
     * ARCHIVED is a workflow status, so the list already exists and already scopes itself — a
     * second screen would be a second place for the scoping to drift.
     *
     * Gated on DOCUMENT_ARCHIVE rather than on a role. The decision names "the records role", but
     * authority here is capability-based by design (the client never reasons from `role`), and the
     * people who can archive a document are the people who have reason to review the archive.
     */
    href: '/documents?status=ARCHIVED',
    label: 'Archive',
    icon: Archive,
    capability: 'DOCUMENT_ARCHIVE',
  },
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
export const isNavItemActive = (pathname: string, href: string): boolean => {
  const path = href.split('?')[0] ?? href;
  return pathname === path || pathname.startsWith(`${path}/`);
};

/**
 * Which single destination is the one currently open.
 *
 * Two items now point at `/documents` — the registry and the archive, which is the same list
 * filtered to ARCHIVED — so "does this item match the path" is no longer enough to pick one. The
 * more specific item wins: an item whose query is satisfied by the current URL beats one with no
 * query at all, which is what stops the registry and the archive lighting up together, and what
 * stops the archive never lighting up because its `?status=` is not part of the pathname.
 *
 * Returns the winning href, or null when nothing matches. Taking the whole list rather than
 * answering per item is the point: "most specific" is not a property any single item has.
 */
export const activeNavHref = (
  pathname: string,
  search: URLSearchParams,
  items: readonly NavItem[],
): string | null => {
  let best: { href: string; score: number } | null = null;

  for (const item of items) {
    if (!isNavItemActive(pathname, item.href)) continue;

    const query = new URLSearchParams(item.href.split('?')[1] ?? '');
    // Every parameter the item names has to be present with that value; an item asking for
    // ARCHIVED must not match the unfiltered registry.
    let satisfied = true;
    let score = 0;
    for (const [key, value] of query) {
      if (search.get(key) !== value) {
        satisfied = false;
        break;
      }
      score += 1;
    }
    if (!satisfied) continue;
    if (best === null || score > best.score) best = { href: item.href, score };
  }

  return best?.href ?? null;
};
