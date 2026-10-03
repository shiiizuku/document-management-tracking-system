import { roleSchema, type RoleGrant } from '@dts/contracts';
import { OFFICE_WIDE_READ_ROLES } from './authorization.policy.js';
import { capabilitiesByRole } from './role-capabilities.js';

/**
 * The role table as `GET /roles` serves it: one entry per role, in `roleSchema` order.
 *
 * Serialized from `capabilitiesByRole` and `OFFICE_WIDE_READ_ROLES` themselves, never from a
 * second literal, so what the picker shows cannot drift from what the server enforces.
 */
export const roleGrants = (): RoleGrant[] =>
  roleSchema.options.map((role) => ({
    role,
    capabilities: [...capabilitiesByRole[role]],
    readsOfficeWide: OFFICE_WIDE_READ_ROLES.has(role),
  }));
