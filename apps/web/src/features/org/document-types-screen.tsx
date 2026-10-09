'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, Pencil, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { createDocumentTypeSchema } from '@dts/contracts';
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
  useCreateDocumentType,
  useDocumentTypes,
  useUpdateDocumentType,
  type DocumentType,
} from './queries';

/**
 * The document types records staff choose from when registering a document.
 *
 * Nothing here deletes, for the same reason divisions are never deleted: every document filed under
 * a type keeps its code, and the registry filter and the monthly report read it. Retiring a type
 * takes it out of the register form and leaves every existing document reading as it did. The code
 * is fixed once created; the label is free to change.
 */
const typeFormSchema = createDocumentTypeSchema.extend({ active: z.boolean() });
type TypeFormValues = z.infer<typeof typeFormSchema>;

/** "Notice of violation" → `NOTICE_OF_VIOLATION`, the shape the contract requires of a code. */
export const codeFromLabel = (label: string): string =>
  label
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .replace(/^[0-9_]+/, '')
    .slice(0, 80);

export function DocumentTypesScreen() {
  const types = useDocumentTypes();

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Document types"
        count={types.data?.length}
        description="What records staff can file a document as. Retire a type to stop offering it; documents already filed under it keep it."
        actions={<DocumentTypeDialog />}
      />

      {types.isPending ? (
        <Skeleton className="h-40 w-full" aria-hidden />
      ) : types.error !== null ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>The document types could not be loaded</AlertTitle>
          <AlertDescription>
            <p>{types.error instanceof Error ? types.error.message : 'Something went wrong.'}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => void types.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : (types.data ?? []).length === 0 ? (
        <EmptyState
          icon={Tags}
          title="No document types yet"
          description="Add at least one type before registering documents."
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
          {(types.data ?? []).map((type) => (
            <li key={type.id} className="flex items-center gap-3 px-4 py-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-foreground">{type.label}</span>
                <code className="shrink-0 rounded-md border-[1.5px] border-seal px-1.5 py-0.5 font-mono text-xs font-semibold text-seal-foreground">
                  {type.code}
                </code>
                {type.active ? null : <Badge variant="outline">Retired</Badge>}
              </div>
              <DocumentTypeDialog type={type} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** One dialog to add a type and to edit one; editing offers the label and whether it is offered. */
function DocumentTypeDialog({ type }: Readonly<{ type?: DocumentType }>) {
  const editing = type !== undefined;
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // The code follows the label until someone types in the code field themselves.
  const [codeTouched, setCodeTouched] = useState(false);
  const create = useCreateDocumentType();
  const update = useUpdateDocumentType();
  const pending = create.isPending || update.isPending;

  const form = useForm<TypeFormValues>({
    resolver: zodResolver(typeFormSchema),
    defaultValues: {
      code: type?.code ?? '',
      label: type?.label ?? '',
      active: type?.active ?? true,
    },
  });

  const onSubmit = (values: TypeFormValues) => {
    setFormError(null);
    const handlers = {
      onSuccess: (saved: DocumentType) => {
        setOpen(false);
        if (!editing) {
          form.reset({ code: '', label: '', active: true });
          setCodeTouched(false);
        }
        toast.success(editing ? `Updated ${saved.label}` : `Added ${saved.label}`);
      },
      onError: (error: unknown) => setFormError(applyServerErrors(form, error)),
    };

    if (editing)
      update.mutate(
        { id: type.id, patch: { label: values.label, active: values.active } },
        handlers,
      );
    else create.mutate({ code: values.code, label: values.label }, handlers);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${type.label}`}>
            <Pencil />
            Edit
          </Button>
        ) : (
          <Button>
            <Plus />
            Add type
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="eyebrow">{editing ? 'Edit document type' : 'New document type'}</p>
          <DialogTitle>{editing ? type.label : 'Add document type'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `Code ${type.code} cannot change — documents already filed under it store it.`
              : 'The code is stored on every document filed under this type and cannot change later.'}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not save this document type</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="label"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input
                      maxLength={120}
                      {...field}
                      onChange={(event) => {
                        field.onChange(event.target.value);
                        if (!editing && !codeTouched)
                          form.setValue('code', codeFromLabel(event.target.value));
                      }}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {editing ? null : (
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Code</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={80}
                        className="font-mono uppercase"
                        {...field}
                        onChange={(event) => {
                          setCodeTouched(true);
                          field.onChange(event.target.value.toUpperCase());
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Filled in from the name. Uppercase letters, digits and underscores.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {editing ? (
              <FormField
                control={form.control}
                name="active"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-start gap-3">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                      />
                    </FormControl>
                    <div className="space-y-1">
                      <FormLabel>Offered</FormLabel>
                      <FormDescription>
                        Untick to retire it from the register form. Documents already filed under it
                        keep it.
                      </FormDescription>
                    </div>
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
                {editing ? 'Save changes' : 'Add type'}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
