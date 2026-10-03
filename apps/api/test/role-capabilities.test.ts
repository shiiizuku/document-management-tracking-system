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

  /*
   * The privilege reduction of ADR-0006, asserted as a property of the table rather than left to
   * the integration suites to discover. `DOCUMENT_SIGN` sits with exactly two roles: the Director,
   * who is the signatory, and the administrator, who retains it as break-glass. A role picking it
   * back up — the easy mistake when copying a block in this file — fails here.
   */
  it('keeps signing with the director, and the administrator only as break-glass', () => {
    const signers = Object.entries(capabilitiesByRole)
      .filter(([, capabilities]) => capabilities.includes('DOCUMENT_SIGN'))
      .map(([role]) => role)
      .sort();
    expect(signers).toEqual(['ADMINISTRATOR', 'DIRECTOR']);
  });

  // Initialling is the division head's half of the split: the Director must not hold it, or the
  // two-step approval collapses back into one person's two clicks.
  it('keeps initialling away from the director', () => {
    expect(capabilitiesByRole.DIRECTOR).not.toContain('DOCUMENT_INITIAL');
  });

  // VIEWER is read-only by design: scope still lets them read, but no capability means no mutation
  // and, on the client, no capability-gated nav item.
  it('grants a viewer nothing', () => {
    expect(capabilitiesByRole.VIEWER).toEqual([]);
  });
});
