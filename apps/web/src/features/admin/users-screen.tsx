'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, KeyRound, Loader2, Plus, UserCog, Users } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  createUserSchema,
  resetPasswordSchema,
  roleSchema,
  updateUserSchema,
  type CreateUserInput,
  type ResetPasswordInput,
  type UpdateUserInput,
} from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { DataTable, type DataTableColumn } from '@/components/dts/data-table';
import { EmptyState } from '@/components/dts/empty-state';
import { FilterBar } from '@/components/dts/filter-bar';
import { PageHeader } from '@/components/dts/page-header';
import { useDivisions, useSections } from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { applyServerErrors } from '@/lib/forms';
import { enumLabel } from '@/lib/utils';
import {
  DEFAULT_USER_FILTERS,
  useCreateUser,
  useResetPassword,
  useSetUserActive,
  useUpdateUser,
  useUsers,
  type AdminUser,
  type UserFilters,
} from './queries';
import { RoleField, membershipNeeds } from './role-field';

/**
 * The user directory and the controls that change it.
 *
 * Two things here are deliberate and would be wrong if done the obvious way.
 *
 * Accounts are never deleted, only deactivated. The audit trail names actors by id and that
 * reference has to keep resolving years later, so "remove this person" means "stop them signing in"
 * — and the control says so.
 *
 * And nobody deactivates or demotes themselves. The API would allow it — an administrator editing
 * their own row is a legitimate request — but the result is a console that has just locked its only
 * operator out of itself, so those two controls are withheld on the signed-in user's own row with a
 * reason given.
 */

/** Radix cannot hold `''` as a select value, and "no section" is a real choice. */
const NO_SECTION = '__none__';

export function UsersScreen() {
  // Local state rather than the URL: this is an administrative lookup, not a view anyone links to.
  const [filters, setFilters] = useState<UserFilters>(DEFAULT_USER_FILTERS);
  const [searchDraft, setSearchDraft] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);

  const { user: signedIn } = useSession();
  const users = useUsers(filters);
  const divisions = useDivisions();
  const rows = users.data ?? [];

  const columns: readonly DataTableColumn<AdminUser>[] = [
    {
      id: 'person',
      header: 'Person',
      cell: (row) => (
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-foreground">{row.displayName}</span>
            {row.id === signedIn?.id ? (
              <Badge variant="outline" className="shrink-0">
                You
              </Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) => <span className="text-sm text-foreground">{enumLabel(row.role)}</span>,
    },
    {
      id: 'placement',
      header: 'Placement',
      className: 'hidden lg:table-cell',
      cell: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.divisionId === null
            ? 'Office-wide'
            : ((divisions.data ?? []).find((division) => division.id === row.divisionId)?.name ??
              row.divisionId)}
        </span>
      ),
    },
    {
      id: 'state',
      header: 'State',
      cell: (row) => (
        <div className="flex flex-wrap gap-1">
          <Badge variant={row.active ? 'secondary' : 'destructive'}>
            {row.active ? 'Active' : 'Deactivated'}
          </Badge>
          {/* A lockout is not a deactivation: it expires on its own, and conflating the two has
              someone reactivating an account that was never switched off. */}
          {row.locked ? <Badge variant="outline">Locked out</Badge> : null}
          {row.canAccessConfidential ? <Badge variant="outline">Confidential</Badge> : null}
        </div>
      ),
    },
    {
      id: 'lastLoginAt',
      header: 'Last signed in',
      className: 'hidden whitespace-nowrap sm:table-cell',
      align: 'end',
      cell: (row) =>
        row.lastLoginAt === null ? (
          <span className="text-sm text-muted-foreground">Never</span>
        ) : (
          <time dateTime={row.lastLoginAt} className="text-sm text-muted-foreground tabular-nums">
            {new Date(row.lastLoginAt).toLocaleDateString()}
          </time>
        ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Manage</span>,
      align: 'end',
      cell: (row) => (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(row)}>
            <UserCog />
            Edit
          </Button>
          {/* Not on one's own row: a reset skips the current-password check, so the API refuses
              it there. The account menu's Change password is the way to change your own. */}
          {row.id === signedIn?.id ? null : (
            <Button type="button" variant="ghost" size="sm" onClick={() => setResetting(row)}>
              <KeyRound />
              Reset password
            </Button>
          )}
          <ActiveToggle user={row} isSelf={row.id === signedIn?.id} />
        </div>
      ),
    },
  ];

  const applyFilters = (patch: Partial<UserFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        count={users.data?.length}
        description="Who may sign in, what role they hold, and where in the organization they sit."
        actions={<CreateUserDialog />}
      />

      <FilterBar
        search={{
          value: searchDraft,
          placeholder: 'Search name or email',
          onChange: setSearchDraft,
          onSubmit: () => applyFilters({ search: searchDraft }),
        }}
        selects={[
          {
            id: 'role',
            label: 'Role',
            anyLabel: 'Any role',
            options: roleSchema.options.map((option) => ({
              value: option,
              label: enumLabel(option),
            })),
          },
          {
            id: 'divisionId',
            label: 'Division',
            anyLabel: 'Any division',
            options: (divisions.data ?? []).map((division) => ({
              value: division.id,
              label: division.name,
            })),
          },
          {
            id: 'active',
            label: 'State',
            anyLabel: 'Any state',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Deactivated' },
            ],
          },
        ]}
        values={{ role: filters.role, divisionId: filters.divisionId, active: filters.active }}
        onSelectChange={(id, value) => applyFilters({ [id]: value })}
        onClear={() => {
          setSearchDraft('');
          setFilters(DEFAULT_USER_FILTERS);
        }}
      />

      <DataTable<AdminUser>
        caption="User accounts"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        // The endpoint returns the whole directory, so the pager reports one page of everything
        // rather than implying a server-side window that does not exist.
        total={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        onPageChange={() => undefined}
        isLoading={users.isPending}
        isFetching={users.isFetching}
        error={users.error}
        onRetry={() => void users.refetch()}
        empty={
          <EmptyState
            icon={Users}
            title="No accounts match"
            description="Try a broader search, or clear the filters to see everyone."
            className="border-0 bg-transparent"
          />
        }
      />

      {editing === null ? null : <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
      {resetting === null ? null : (
        <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />
      )}
    </>
  );
}

/**
 * Deactivation and reactivation, as one control.
 *
 * Withheld on the signed-in user's own row: an administrator deactivating themselves is a request
 * the API will honour and that nobody can undo from inside the app.
 */
function ActiveToggle({ user, isSelf }: Readonly<{ user: AdminUser; isSelf: boolean }>) {
  const setActive = useSetUserActive();

  if (isSelf)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        title="You cannot deactivate your own account"
      >
        Deactivate
      </Button>
    );

  const onClick = () =>
    setActive.mutate(
      { id: user.id, active: !user.active },
      {
        onSuccess: (updated) =>
          toast.success(updated.active ? 'Account reactivated' : 'Account deactivated', {
            description: updated.active
              ? `${updated.displayName} can sign in again.`
              : `${updated.displayName} can no longer sign in. Their recorded actions are unchanged.`,
          }),
        onError: (error) =>
          toast.error('Could not change this account', {
            description: error instanceof Error ? error.message : 'Please try again.',
          }),
      },
    );

  return (
    <Button
      type="button"
      variant={user.active ? 'ghost' : 'outline'}
      size="sm"
      onClick={onClick}
      disabled={setActive.isPending}
    >
      {setActive.isPending ? <Loader2 className="animate-spin" /> : null}
      {user.active ? 'Deactivate' : 'Reactivate'}
    </Button>
  );
}

/**
 * A new account, created directly rather than through the request queue.
 *
 * Resolved by `createUserSchema`, which carries both the strong-password rule and the membership
 * rules — so the password policy the API enforces is the one this field checks, and an administrator
 * is not told about it only after pressing Save.
 */
type CreateFormValues = z.input<typeof createUserSchema>;

function CreateUserDialog() {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateUser();

  const form = useForm<CreateFormValues, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      displayName: '',
      password: '',
      role: 'STAFF_MEMBER',
      canAccessConfidential: false,
    },
  });

  const divisions = useDivisions();
  const divisionId = form.watch('divisionId');
  const sectionOptions = useSections(divisionId ?? null).data ?? [];
  const needs = membershipNeeds(form.watch('role'));

  const onSubmit = (values: CreateUserInput) => {
    setFormError(null);
    create.mutate(values, {
      onSuccess: (user) => {
        setOpen(false);
        form.reset();
        toast.success(`Created ${user.displayName}`, {
          description: `The account is active as ${enumLabel(user.role)}.`,
        });
      },
      onError: (error) => setFormError(applyServerErrors(form, error)),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // The form holds a password. It does not survive a cancelled dialog.
        if (!next) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Add user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <p className="eyebrow">New account</p>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            The account is active immediately. The person should change this password after their
            first sign-in.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not create this account</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input maxLength={200} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Initial password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    At least 12 characters, with an upper- and lowercase letter, a digit and a
                    symbol.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <RoleField control={form.control} name="role" />

            <FormField
              control={form.control}
              name="divisionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Division{needs.division ? '' : ' (optional)'}</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) => {
                      field.onChange(value === NO_SECTION ? undefined : value);
                      // The chosen section belongs to the old division and would be refused.
                      form.setValue('sectionId', undefined);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a division" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>Office-wide (no division)</SelectItem>
                      {(divisions.data ?? []).map((division) => (
                        <SelectItem key={division.id} value={division.id}>
                          {division.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section{needs.section ? '' : ' (optional)'}</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) =>
                      field.onChange(value === NO_SECTION ? undefined : value)
                    }
                    disabled={sectionOptions.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>
                        {sectionOptions.length === 0
                          ? 'No sections'
                          : 'Division-level (no section)'}
                      </SelectItem>
                      {sectionOptions.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="canAccessConfidential"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel>May open confidential documents</FormLabel>
                    <FormDescription>
                      Granted separately from the role, and audited.
                    </FormDescription>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : null}
                Create account
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Role, placement and confidential access on an existing account.
 *
 * Email is absent because the API does not accept a change to it: the address is the identity a
 * person signs in with and is referenced by their account-request record, so a correction means a
 * new account rather than a patch. A field the server would reject is worse than no field.
 *
 * The three placement fields are written out again here rather than shared with the create dialog,
 * because the two forms mean different things by an empty value: creating omits a placement
 * (`undefined`), while editing has to be able to *clear* one (`null`), and the patch schema tells
 * those apart deliberately.
 */
type EditFormValues = z.input<typeof updateUserSchema>;

function EditUserDialog({ user, onClose }: Readonly<{ user: AdminUser; onClose: () => void }>) {
  const [formError, setFormError] = useState<string | null>(null);
  const update = useUpdateUser();
  const { user: signedIn } = useSession();
  const isSelf = user.id === signedIn?.id;

  const form = useForm<EditFormValues, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      displayName: user.displayName,
      role: user.role,
      divisionId: user.divisionId,
      sectionId: user.sectionId,
      canAccessConfidential: user.canAccessConfidential,
    },
  });

  const divisions = useDivisions();
  const divisionId = form.watch('divisionId');
  const sectionOptions = useSections(divisionId ?? null).data ?? [];
  const needs = membershipNeeds(form.watch('role') ?? user.role);

  const onSubmit = (patch: UpdateUserInput) => {
    setFormError(null);
    update.mutate(
      { id: user.id, patch },
      {
        onSuccess: (updated) => {
          onClose();
          toast.success(`Updated ${updated.displayName}`);
        },
        onError: (error) => setFormError(applyServerErrors(form, error)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <p className="eyebrow">Edit account</p>
          <DialogTitle>{user.displayName}</DialogTitle>
          <DialogDescription>
            {user.email} · The email address cannot be changed; create a new account instead.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not save these changes</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {isSelf ? (
              <Alert>
                <AlertCircle />
                <AlertTitle>This is your own account</AlertTitle>
                <AlertDescription>
                  Changing your own role can remove your access to this screen, so the role is left
                  as it is. Ask another administrator to change it.
                </AlertDescription>
              </Alert>
            ) : null}

            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Full name</FormLabel>
                  <FormControl>
                    <Input maxLength={200} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <RoleField control={form.control} name="role" fallback={user.role} disabled={isSelf} />

            <FormField
              control={form.control}
              name="divisionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Division{needs.division ? '' : ' (optional)'}</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) => {
                      // `null`, not `undefined`: the patch schema tells "leave as is" apart from
                      // "clear it", and an account has to be able to become office-wide.
                      field.onChange(value === NO_SECTION ? null : value);
                      form.setValue('sectionId', null);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a division" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>Office-wide (no division)</SelectItem>
                      {(divisions.data ?? []).map((division) => (
                        <SelectItem key={division.id} value={division.id}>
                          {division.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section{needs.section ? '' : ' (optional)'}</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) => field.onChange(value === NO_SECTION ? null : value)}
                    disabled={sectionOptions.length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>
                        {sectionOptions.length === 0
                          ? 'No sections'
                          : 'Division-level (no section)'}
                      </SelectItem>
                      {sectionOptions.map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="canAccessConfidential"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel>May open confidential documents</FormLabel>
                    <FormDescription>
                      Granted separately from the role, and audited.
                    </FormDescription>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? <Loader2 className="animate-spin" /> : null}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * An administrator sets a new password for someone who has forgotten theirs, or whose account may
 * be compromised (risk R-22). The person is signed out everywhere and any lockout is cleared, and
 * the dialog says so before the administrator commits to it.
 */
function ResetPasswordDialog({
  user,
  onClose,
}: Readonly<{ user: AdminUser; onClose: () => void }>) {
  const [formError, setFormError] = useState<string | null>(null);
  const reset = useResetPassword();
  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = (input: ResetPasswordInput) => {
    setFormError(null);
    reset.mutate(
      { id: user.id, input },
      {
        onSuccess: () => {
          onClose();
          toast.success(`Reset the password for ${user.displayName}`, {
            description: 'Give them the new password, and ask them to change it after signing in.',
          });
        },
        onError: (error) => setFormError(applyServerErrors(form, error)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="eyebrow">Reset password</p>
          <DialogTitle>{user.displayName}</DialogTitle>
          <DialogDescription>
            {user.email} · They will be signed out everywhere, and any lockout is cleared.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not reset this password</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    At least 12 characters, with an upper- and lowercase letter, a digit and a
                    symbol.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={reset.isPending}>
                {reset.isPending ? <Loader2 className="animate-spin" /> : null}
                Reset password
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
