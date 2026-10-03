'use client';

import type { ReactNode } from 'react';
import type { Control, FieldPath, FieldValues } from 'react-hook-form';
import { roleSchema, type Role, type RoleGrant } from '@dts/contracts';
import { Badge } from '@/components/ui/badge';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { enumLabel } from '@/lib/utils';
import { CAPABILITY_GROUPS, capabilityLabels } from './capability-labels';
import { useRoleGrants } from './role-grants';

/**
 * Which parts of the organization tree a role must be pinned to.
 *
 * The same rule `membershipRules` enforces in `@dts/contracts`, read here only to mark the fields
 * required or optional. It is a presentation decision, not a second validation: the schema rejects a
 * missing division either way, so a disagreement costs a label rather than a bad save.
 */
export const membershipNeeds = (
  role: string | undefined,
): { division: boolean; section: boolean } => ({
  division: role !== 'ADMINISTRATOR' && role !== 'RECORDS_STAFF',
  section: role === 'STAFF_MEMBER' || role === 'VIEWER',
});

/**
 * The role picker, shared by create user, edit user and approve account request, with what the
 * selected role grants listed under it (decision 175).
 *
 * The list is display only and re-renders as the role changes. If `/roles` fails the list is simply
 * absent: it describes a choice the server validates anyway, so it never blocks the form.
 */
export function RoleField<T extends FieldValues>({
  control,
  name,
  fallback,
  disabled = false,
  description,
}: Readonly<{
  control: Control<T>;
  name: FieldPath<T>;
  /** Shown while the form holds no value yet — the account's current role, when editing. */
  fallback?: Role;
  disabled?: boolean;
  description?: ReactNode;
}>) {
  const grants = useRoleGrants();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const value = (field.value as Role | undefined) ?? fallback;
        const grant = grants.data?.find((entry) => entry.role === value);
        return (
          <FormItem>
            <FormLabel>Role</FormLabel>
            <Select
              {...(value === undefined ? {} : { value })}
              onValueChange={field.onChange}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {roleSchema.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {enumLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {description === undefined ? null : <FormDescription>{description}</FormDescription>}
            <FormMessage />
            {grant === undefined ? null : <RoleGrantList grant={grant} />}
          </FormItem>
        );
      }}
    />
  );
}

/** What one role grants, grouped, plus its read scope — which is not a capability. */
function RoleGrantList({ grant }: Readonly<{ grant: RoleGrant }>) {
  const groups = CAPABILITY_GROUPS.map((group) => ({
    group,
    capabilities: grant.capabilities.filter(
      (capability) => capabilityLabels[capability].group === group,
    ),
  })).filter((entry) => entry.capabilities.length > 0);

  return (
    <div
      role="group"
      aria-label={`What ${enumLabel(grant.role)} grants`}
      className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-body-small"
    >
      <span className="text-label-small text-muted-foreground">Reads</span>
      <span className="text-foreground">
        {grant.readsOfficeWide ? 'Every division' : 'Its own division or section'}
      </span>
      {groups.length === 0 ? (
        <>
          <span className="text-label-small text-muted-foreground">Acts</span>
          <span className="text-muted-foreground">Read only — takes no action on documents</span>
        </>
      ) : (
        groups.map(({ group, capabilities }) => (
          <div key={group} className="contents">
            <span className="text-label-small text-muted-foreground">{group}</span>
            <ul className="flex flex-wrap gap-1">
              {capabilities.map((capability) => (
                <li key={capability}>
                  <Badge variant="outline" className="font-normal">
                    {capabilityLabels[capability].label}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
