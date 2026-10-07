'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveAccountRequestInput,
  CreateUserInput,
  ResetPasswordInput,
  Role,
  SubmitAccountRequestInput,
  UpdateUserInput,
} from '@dts/contracts';
import { api } from '@/lib/api';

/**
 * The administration console's data: the people with accounts, and the people asking for one.
 *
 * The two belong in one module because they are one lifecycle. Approving a request *creates* a
 * user, so an approval has to settle both lists; split across two modules, that cross-invalidation
 * is the rule each one assumes the other is keeping, and the symptom is an approved applicant who
 * does not appear under Users until the page is reloaded.
 *
 * The public submission lives here too, for the same reason: it is the first state of the record
 * the review screens act on, so the wire shape is declared once. It is the one request in this
 * module that needs no session.
 */

/** A user as the administration table serves it. Dates arrive as ISO strings. */
export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  divisionId: string | null;
  sectionId: string | null;
  canAccessConfidential: boolean;
  active: boolean;
  /**
   * Temporarily locked out by failed sign-ins. Distinct from `active`, which is an administrative
   * decision: a lock expires on its own, and showing them the same way would have someone
   * reactivating an account that was never deactivated.
   */
  locked: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** An account request as the review queue serves it. The applicant's password never appears. */
export interface AccountRequest {
  id: string;
  email: string;
  displayName: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requestedDivisionId: string | null;
  requestedSectionId: string | null;
  justification: string | null;
  reviewedById: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  createdUserId: string | null;
  createdAt: string;
}

export interface UserFilters {
  search: string;
  role: string;
  divisionId: string;
  /** `''` for either, `'true'`/`'false'` to narrow — the string the API's `stringbool` parses. */
  active: string;
}

export const DEFAULT_USER_FILTERS: UserFilters = {
  search: '',
  role: '',
  divisionId: '',
  active: '',
};

const adminKeys = {
  all: ['admin'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  userList: (filters: UserFilters) => [...adminKeys.users(), filters] as const,
  requests: () => [...adminKeys.all, 'account-requests'] as const,
  requestList: (status: string) => [...adminKeys.requests(), status] as const,
};

/**
 * Builds the user-list query string, omitting anything not narrowing the list. Exported for its
 * own test: a mistyped parameter name here does not error, it silently stops filtering.
 */
export const usersQueryString = (filters: UserFilters): string => {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.role) params.set('role', filters.role);
  if (filters.divisionId) params.set('divisionId', filters.divisionId);
  if (filters.active) params.set('active', filters.active);
  return params.toString();
};

/**
 * The user directory.
 *
 * `enabled` exists for the audit viewer, which reads this list only to turn actor ids into names
 * and must not ask for it at all when the signed-in user may not read the directory — a 403 in the
 * corner of an otherwise working screen.
 */
export function useUsers(filters: UserFilters, enabled = true) {
  return useQuery({
    queryKey: adminKeys.userList(filters),
    queryFn: () => {
      const query = usersQueryString(filters);
      return api<AdminUser[]>(`/users${query === '' ? '' : `?${query}`}`);
    },
    enabled,
    // Keeps the current rows on screen while a filter change resolves, so the table dims rather
    // than emptying — the same behaviour as the registry.
    placeholderData: (previous) => previous,
  });
}

/**
 * Settles every cached user list.
 *
 * Every user mutation invalidates all of them rather than the one on screen: a role change, a
 * deactivation and a new account all move a row between filtered views, so the list the user is
 * not looking at is exactly the one that would still be wrong when they navigate back to it.
 */
const invalidateUsers = (client: ReturnType<typeof useQueryClient>): void => {
  void client.invalidateQueries({ queryKey: adminKeys.users() });
};

export function useCreateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      api<AdminUser>('/users', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateUsers(client),
  });
}

export function useUpdateUser() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateUserInput }) =>
      api<AdminUser>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => invalidateUsers(client),
  });
}

/**
 * Deactivates or reactivates an account.
 *
 * One hook for both directions because they are one decision with a sign, and the caller is a
 * single control whose label depends on the row. Two hooks would duplicate the invalidation and
 * invite a screen to wire the wrong one to the wrong label.
 */
export function useSetUserActive() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api<AdminUser>(`/users/${id}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' }),
    onSuccess: () => invalidateUsers(client),
  });
}

/**
 * An administrator sets a new password for someone else. The server ends every session that
 * person holds and clears any lockout, so the list is settled for the "Locked out" badge.
 */
export function useResetPassword() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ResetPasswordInput }) =>
      api<void>(`/users/${id}/password`, { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => invalidateUsers(client),
  });
}

export function useAccountRequests(status: string) {
  return useQuery({
    queryKey: adminKeys.requestList(status),
    queryFn: () =>
      api<AccountRequest[]>(`/account-requests${status === '' ? '' : `?status=${status}`}`),
    placeholderData: (previous) => previous,
  });
}

/**
 * Approves a request, which creates the user.
 *
 * Both lists are invalidated, and that is the whole reason this hook is in this module rather than
 * beside the review screen: the new account belongs to a list the review screen has never heard
 * of, and nothing on screen is in a position to remember that.
 */
export function useApproveAccountRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: ApproveAccountRequestInput }) =>
      api<AdminUser>(`/account-requests/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify(decision),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: adminKeys.requests() });
      invalidateUsers(client);
    },
  });
}

export function useRejectAccountRequest() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api<AccountRequest>(`/account-requests/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: adminKeys.requests() }),
  });
}

/**
 * Submits an account request from the public form.
 *
 * The one call in this module with no session, and no cache to settle: the applicant cannot see
 * the queue they have just joined. The server answers `{ submitted: true }` whether or not the
 * address was already taken, so that the form cannot be used to enumerate who has an account —
 * which is why there is nothing here to read back.
 */
export function useSubmitAccountRequest() {
  return useMutation({
    mutationFn: (input: SubmitAccountRequestInput) =>
      api<{ submitted: boolean }>('/account-requests', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });
}
