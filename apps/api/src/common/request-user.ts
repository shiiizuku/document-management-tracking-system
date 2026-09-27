import type { AuthorizationActor } from '../modules/authorization/authorization.policy.js';

export interface RequestUser extends AuthorizationActor {
  email: string;
  displayName: string;
  active: boolean;
}
