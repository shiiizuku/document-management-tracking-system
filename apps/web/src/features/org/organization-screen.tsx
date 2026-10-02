'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Building2, Loader2, Pencil, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { createDivisionSchema, createSectionSchema } from '@dts/contracts';
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
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/dts/empty-state';
import { PageHeader } from '@/components/dts/page-header';
import { applyServerErrors } from '@/lib/forms';
import {
  useCreateDivision,
  useCreateSection,
  useDivisions,
  useSections,
  useUpdateDivision,
  useUpdateSection,
  type Division,
  type Section,
} from './queries';

/**
 * The organization structure: divisions, and the sections inside them.
 *
 * Not a table, unlike every other list in the app, and deliberately: this is the one screen whose
 * subject is a *shape* rather than a set of records. Which sections sit under which division is the
 * question being asked, and a flat table with a "division" column makes the reader reassemble the
 * tree in their head.
 *
 * Nothing here deletes. A division is referenced by every document ever registered under it and by
 * the reference numbers allocated from its code, so the reversible operation is deactivation —
 * which keeps the history readable while removing the row from every picker. The controls say
 * "active" rather than offering a delete that the API would refuse.
 *
 * Codes are immutable once created. They are embedded in allocated reference numbers, so renaming a
 * code would make the documents already issued under it unexplainable; the API accepts a change to
 * `name` and `active` only, and the form offers only those.
 */

/**
 * What the division form holds: the contract's create shape plus the `active` flag an edit can set.
 *
 * One schema for both modes rather than switching resolvers per mode. Switching would leave the
 * form's value type as a union that nothing downstream can narrow, and it buys nothing: when editing,
 * `code` is prefilled from the existing division, not rendered, and not sent — so validating it
 * again is a no-op on a value the server already accepted.
 */
const divisionFormSchema = createDivisionSchema.extend({ active: z.boolean() });
type DivisionFormValues = z.infer<typeof divisionFormSchema>;

/** The same arrangement for a section, which differs only by carrying its division. */
const sectionFormSchema = createSectionSchema.extend({ active: z.boolean() });
type SectionFormValues = z.infer<typeof sectionFormSchema>;
export function OrganizationScreen() {
  const divisions = useDivisions();

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Divisions"
        count={divisions.data?.length}
        description="Divisions and their sections. Codes are fixed once created — they appear in issued reference numbers."
        actions={<DivisionDialog />}
      />

      {divisions.isPending ? (
        <div className="space-y-3" aria-hidden>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : divisions.error !== null ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The organization structure could not be loaded</AlertTitle>
          <AlertDescription>
            <p>
              {divisions.error instanceof Error ? divisions.error.message : 'Something went wrong.'}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => void divisions.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (divisions.data ?? []).length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No divisions yet"
          description="A division is the unit documents are registered against, and its code becomes part of every reference number issued under it."
        />
      ) : (
        <ul className="space-y-3">
          {(divisions.data ?? []).map((division) => (
            <DivisionCard key={division.id} division={division} />
          ))}
        </ul>
      )}
    </>
  );
}

function DivisionCard({ division }: Readonly<{ division: Division }>) {
  const sections = useSections(division.id);

  return (
    <li className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">{division.name}</span>
            <code className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
              {division.code}
            </code>
            {division.active ? null : <Badge variant="outline">Inactive</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {sections.isPending
              ? 'Loading sections…'
              : `${(sections.data ?? []).length} section${(sections.data ?? []).length === 1 ? '' : 's'}`}
          </p>
        </div>
        <DivisionDialog division={division} />
        <SectionDialog divisionId={division.id} />
      </div>

      {(sections.data ?? []).length === 0 ? null : (
        <ul className="divide-y divide-border border-t border-border">
          {(sections.data ?? []).map((section) => (
            <li
              key={section.id}
              className="flex flex-wrap items-center gap-3 bg-secondary/20 px-4 py-2.5 pl-8"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-foreground">{section.name}</span>
                  <code className="shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs text-secondary-foreground">
                    {section.code}
                  </code>
                  {section.active ? null : <Badge variant="outline">Inactive</Badge>}
                </div>
              </div>
              <SectionDialog divisionId={division.id} section={section} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One dialog for creating a division and for editing one.
 *
 * The two forms differ by exactly which fields are offered — a new division needs a code, an
 * existing one cannot change it — so splitting them would duplicate the name field, the error
 * banner and the submit handling to vary one input. Which mode it is in is decided by whether a
 * `division` was passed, and nothing else in the component branches on it.
 */
function DivisionDialog({ division }: Readonly<{ division?: Division }>) {
  const editing = division !== undefined;
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateDivision();
  const update = useUpdateDivision();
  const pending = create.isPending || update.isPending;

  const form = useForm<DivisionFormValues>({
    resolver: zodResolver(divisionFormSchema),
    defaultValues: {
      code: division?.code ?? '',
      name: division?.name ?? '',
      active: division?.active ?? true,
    },
  });

  const onSubmit = (values: DivisionFormValues) => {
    setFormError(null);
    const handlers = {
      onSuccess: (saved: Division) => {
        setOpen(false);
        if (!editing) form.reset({ code: '', name: '', active: true });
        toast.success(editing ? `Updated ${saved.name}` : `Created ${saved.name}`, {
          description: `Division code ${saved.code}.`,
        });
      },
      onError: (error: unknown) => setFormError(applyServerErrors(form, error)),
    };

    if (editing)
      update.mutate(
        { id: division.id, patch: { name: values.name, active: values.active } },
        handlers,
      );
    else create.mutate({ code: values.code, name: values.name }, handlers);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button type="button" variant="outline" size="sm">
            <Pencil />
            Edit
          </Button>
        ) : (
          <Button>
            <Plus />
            Add division
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="eyebrow">{editing ? 'Edit division' : 'New division'}</p>
          <DialogTitle>{editing ? division.name : 'Add division'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'The code cannot change — it appears in every reference number already issued under this division.'
              : 'The code becomes part of every reference number issued under this division, so choose it carefully.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not save this division</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {editing ? null : (
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={20}
                        className="font-mono uppercase"
                        {...field}
                        // Upper-cased as it is typed, because the schema accepts uppercase only and
                        // rejecting the lowercase a user naturally types is a needless round trip.
                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormDescription>
                      2–20 characters: uppercase letters, digits and hyphens.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input maxLength={160} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {editing ? (
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? true}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel>Active</FormLabel>
                      <FormDescription>
                        An inactive division disappears from every picker. Documents already
                        registered under it are untouched and stay readable.
                      </FormDescription>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {editing ? 'Save changes' : 'Create division'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/** The same create-or-edit dialog for a section, which differs only by carrying its division. */
function SectionDialog({
  divisionId,
  section,
}: Readonly<{ divisionId: string; section?: Section }>) {
  const editing = section !== undefined;
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const create = useCreateSection();
  const update = useUpdateSection();
  const pending = create.isPending || update.isPending;

  const form = useForm<SectionFormValues>({
    resolver: zodResolver(sectionFormSchema),
    defaultValues: {
      divisionId,
      code: section?.code ?? '',
      name: section?.name ?? '',
      active: section?.active ?? true,
    },
  });

  const onSubmit = (values: SectionFormValues) => {
    setFormError(null);
    const handlers = {
      onSuccess: (saved: Section) => {
        setOpen(false);
        if (!editing) form.reset({ divisionId, code: '', name: '', active: true });
        toast.success(editing ? `Updated ${saved.name}` : `Created ${saved.name}`);
      },
      onError: (error: unknown) => setFormError(applyServerErrors(form, error)),
    };

    if (editing)
      update.mutate(
        { id: section.id, patch: { name: values.name, active: values.active } },
        handlers,
      );
    else create.mutate({ divisionId, code: values.code, name: values.name }, handlers);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          {editing ? <Pencil /> : <Plus />}
          {editing ? 'Edit' : 'Add section'}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="eyebrow">{editing ? 'Edit section' : 'New section'}</p>
          <DialogTitle>{editing ? section.name : 'Add section'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'The code cannot change once the section exists.'
              : 'Sections subdivide a division. Staff members and viewers are scoped to one.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not save this section</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            {editing ? null : (
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={20}
                        className="font-mono uppercase"
                        {...field}
                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormDescription>
                      2–20 characters: uppercase letters, digits and hyphens.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input maxLength={160} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {editing ? (
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value ?? true}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel>Active</FormLabel>
                      <FormDescription>
                        An inactive section disappears from every picker. Documents registered
                        against it are untouched.
                      </FormDescription>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                {editing ? 'Save changes' : 'Create section'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
