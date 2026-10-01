import { describe, expect, it } from 'vitest';
import { CAPABILITIES, type Capability } from '@dts/contracts';
import { capabilitiesByRole } from '../src/modules/authorization/role-capabilities.js';

/**
 * The role table is typed against the contract enum, so an unknown capability cannot be granted.
 * These cover the two failures the type system cannot see: a capability nobody can exercise, and
 * a role granted the same capability twice.
 */
describe('role capability table', () => {
  const granted = new Set<Capability>(Object.values(capabilitiesByRole).flat());

  it('grants every capability in the contract to at least one role', () => {
    expect(CAPABILITIES.filter((capability) => !granted.has(capability))).toEqual([]);
  });

  it('lists each capability at most once per role', () => {
    for (const [role, capabilities] of Object.entries(capabilitiesByRole)) {
      expect(new Set(capabilities).size, `${role} repeats a capability`).toBe(capabilities.length);
    }
  });

  // VIEWER is read-only by design: scope still lets them read, but no capability means no mutation
  // and, on the client, no capability-gated nav item.
  it('grants a viewer nothing', () => {
    expect(capabilitiesByRole.VIEWER).toEqual([]);
  });
});
