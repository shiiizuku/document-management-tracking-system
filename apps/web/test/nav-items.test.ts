import { describe, expect, it } from 'vitest';
import type { Capability } from '@dts/contracts';
import {
  ADMIN_SECTION,
  NAV_ITEMS,
  isNavItemActive,
  navSections,
  visibleNavItems,
} from '../src/components/dts/nav-items';

const holding =
  (...capabilities: Capability[]) =>
  (capability: Capability) =>
    capabilities.includes(capability);

describe('primary navigation', () => {
  it('shows ungated destinations to any signed-in user', () => {
    const labels = visibleNavItems(() => false).map((item) => item.label);
    expect(labels).toContain('Documents');
  });

  it('hides a destination whose capability the user lacks', () => {
    expect(visibleNavItems(() => false).map((item) => item.label)).not.toContain('Reports');
  });

  it('shows that destination once the capability is held', () => {
    const labels = visibleNavItems(holding('REPORT_VIEW')).map((item) => item.label);
    expect(labels).toContain('Reports');
  });

  // The session fails `can` closed while it loads; this is the consequence worth pinning — no
  // gated item is ever rendered before the server has said what the user may do.
  it('reveals nothing gated before authority is known', () => {
    const gated = NAV_ITEMS.filter((item) => item.capability !== undefined);
    expect(gated.length).toBeGreaterThan(0);
    expect(visibleNavItems(() => false)).toHaveLength(NAV_ITEMS.length - gated.length);
  });

  it('keeps a section highlighted while a record below it is open', () => {
    expect(isNavItemActive('/documents/abc-123', '/documents')).toBe(true);
  });

  it('does not highlight a sibling route that merely shares a prefix', () => {
    expect(isNavItemActive('/documents-archive', '/documents')).toBe(false);
  });
});

describe('navigation grouping', () => {
  it('gives the everyday screens no heading', () => {
    const groups = navSections(() => false);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.section).toBeUndefined();
  });

  // The failure this guards against: a heading rendered above nothing, which tells a user an area
  // exists that they cannot reach.
  it('omits the administration heading entirely for a user with none of its capabilities', () => {
    expect(navSections(() => false).map((group) => group.section)).not.toContain(ADMIN_SECTION);
  });

  it('shows the administration heading once one of its destinations is visible', () => {
    const groups = navSections(holding('AUDIT_VIEW'));
    const admin = groups.find((group) => group.section === ADMIN_SECTION);
    expect(admin?.items.map((item) => item.label)).toEqual(['Audit trail']);
  });

  it('collects every administrative destination under one heading', () => {
    const groups = navSections(
      holding('AUDIT_VIEW', 'ACCOUNT_REQUEST_REVIEW', 'USER_MANAGE', 'ORG_MANAGE'),
    );
    expect(groups.filter((group) => group.section === ADMIN_SECTION)).toHaveLength(1);
    expect(groups.find((group) => group.section === ADMIN_SECTION)?.items).toHaveLength(4);
  });

  it('loses no visible item to the grouping', () => {
    const can = holding('REPORT_VIEW', 'AUDIT_VIEW', 'USER_MANAGE');
    const grouped = navSections(can).flatMap((group) => group.items);
    expect(grouped).toEqual(visibleNavItems(can));
  });
});
