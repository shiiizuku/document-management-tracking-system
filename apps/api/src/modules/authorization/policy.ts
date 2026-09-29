import type { AuthorizationActor } from './authorization.policy.js';

/**
 * Every authorization question in the system is asked through this one shape, so a new
 * resource type is added by writing a policy rather than by sprinkling role checks through
 * a service. Actions are namespaced `<resource>:<verb>` strings; the resource is `null` for
 * collection-level actions such as `user:list`, where there is nothing individual to inspect.
 *
 * Policies are pure and synchronous on purpose: they take an already-loaded actor and an
 * already-loaded resource, which keeps them trivially table-testable and keeps the
 * authorization matrix honest. Anything that needs a query belongs in the scoping helpers
 * (`scopeToActor`) instead, so a list never loads rows it will then have to discard.
 */
export interface Policy<TResource> {
  /** The `<resource>` half of the action strings this policy answers for. */
  readonly resourceType: string;
  can(actor: AuthorizationActor, action: string, resource: TResource | null): boolean;
}

/** The verb half of an action string, e.g. `create` in `user:create`. */
export const actionVerb = (action: string): string => action.slice(action.indexOf(':') + 1);

/** The resource half of an action string, e.g. `user` in `user:create`. */
export const actionResourceType = (action: string): string => {
  const separator = action.indexOf(':');
  return separator === -1 ? action : action.slice(0, separator);
};
