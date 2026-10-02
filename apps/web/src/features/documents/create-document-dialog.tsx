'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  createDocumentSchema,
  documentDirectionSchema,
  documentPrioritySchema,
  type CreateDocumentInput,
} from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
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
import { Textarea } from '@/components/ui/textarea';
import { documentTypeLabel } from '@/components/dts/status-badge';
import { useDivisions, useSections } from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { applyServerErrors } from '@/lib/forms';
import { dueDateToIso, isoToDueDate } from './due-date';
import { DOCUMENT_TYPES, useCreateDocument } from './queries';

/** Radix cannot hold `''` as a select value, and "no section" is a real choice. */
const NO_SECTION = '__none__';

/**
 * Registers a new document.
 *
 * `createDocumentSchema` is the server's own schema, so the conditional rule it carries — an
 * incoming document must name a sender — is enforced here by the same code that enforces it at
 * the API, rather than by a second copy that can drift out of step with it.
 *
 * On success it goes straight to the new record. The tracking number is assigned by the server
 * and is the thing the user needs next, whether to write it on the physical document or to attach
 * the scan.
 */

/**
 * What the form holds, which is not what the API receives: the schema defaults `confidential`, so
 * it is optional going in and guaranteed coming out. `useForm`'s third type argument is the
 * post-validation shape, which is what the submit handler is given.
 */
type CreateFormValues = z.input<typeof createDocumentSchema>;
export function CreateDocumentDialog() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { user } = useSession();
  const create = useCreateDocument();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CreateFormValues, unknown, CreateDocumentInput>({
    resolver: zodResolver(createDocumentSchema),
    defaultValues: {
      title: '',
      type: 'MEMORANDUM',
      priority: 'NORMAL',
      direction: 'INCOMING',
      divisionId: user?.divisionId ?? '',
      description: '',
      sender: '',
      company: '',
      referenceNumber: '',
    },
  });

  const divisions = useDivisions();
  const divisionId = form.watch('divisionId');
  const sections = useSections(divisionId || null);
  const direction = form.watch('direction');

  // Default to the user's own division once the list arrives, or to the only one there is. Doing
  // it here rather than in `defaultValues` is what covers the case where the session resolved
  // after the form was constructed.
  useEffect(() => {
    if (divisionId) return;
    const fallback = user?.divisionId ?? divisions.data?.[0]?.id;
    if (fallback) form.setValue('divisionId', fallback);
  }, [divisionId, divisions.data, form, user]);

  const onSubmit = (values: CreateDocumentInput) => {
    setFormError(null);
    create.mutate(values, {
      onSuccess: (document) => {
        setOpen(false);
        form.reset();
        toast.success(`Registered ${document.trackingNumber}`, { description: document.title });
        router.push(`/documents/${document.id}`);
      },
      onError: (error) => setFormError(applyServerErrors(form, error)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Register document
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <p className="eyebrow">New registry entry</p>
          <DialogTitle>Register document</DialogTitle>
          <DialogDescription>
            The tracking number is assigned on save and cannot be chosen.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4 sm:grid-cols-2">
            {formError === null ? null : (
              <Alert variant="destructive" className="sm:col-span-2">
                <AlertCircle />
                <AlertTitle>Could not register this document</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input maxLength={240} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="direction"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Direction</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {documentDirectionSchema.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option === 'INCOMING' ? 'Incoming' : 'Outgoing'}
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
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Priority</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {documentPrioritySchema.options.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
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
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {documentTypeLabel(option)}
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
              name="divisionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Division</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      // The chosen section belongs to the old division and would be rejected.
                      form.setValue('sectionId', undefined);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a division" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
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
                  <FormLabel>Section</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) =>
                      field.onChange(value === NO_SECTION ? undefined : value)
                    }
                    disabled={(sections.data ?? []).length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>
                        {(sections.data ?? []).length === 0
                          ? 'No sections'
                          : 'Division-level (no section)'}
                      </SelectItem>
                      {(sections.data ?? []).map((section) => (
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
              name="sender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Sender</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  {direction === 'INCOMING' ? (
                    <FormDescription>Required for an incoming document.</FormDescription>
                  ) : null}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Company / agency</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="referenceNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>External reference</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="dueAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target date (optional)</FormLabel>
                  <FormControl>
                    {/*
                      A day in, an instant out. The contract types `dueAt` as a datetime, but the
                      deadline a clerk sets is a date, so `dueDateToIso` pins it to the end of that
                      day — see features/documents/due-date.ts for why the end rather than the start.
                    */}
                    <Input
                      type="date"
                      value={isoToDueDate(field.value)}
                      onChange={(event) => field.onChange(dueDateToIso(event.target.value))}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea rows={4} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? <Loader2 className="animate-spin" /> : null}
                Register document
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
