import { describe, expect, it } from 'vitest';
import type { Capability } from '@dts/contracts';
import { NAV_ITEMS, isNavItemActive, visibleNavItems } from '../src/components/dts/nav-items';

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
