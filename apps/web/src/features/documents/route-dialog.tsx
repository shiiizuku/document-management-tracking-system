'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { routeDocumentSchema, type RouteDocumentInput } from '@dts/contracts';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useDivisions, useSections } from '@/features/org/queries';
import { ApiError } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { currentCustody, useRouteDocument, type DocumentDetail } from './queries';

/** Radix cannot hold `''` as a select value, and "the whole division" is a real choice. */
const NO_SECTION = '__none__';

/**
 * Forwards a document to another division or section, optionally copying other divisions in for
 * information.
 *
 * Forwarding *adds* a reader rather than moving access: the receiving unit gains the document and
 * the unit that handled it keeps it, so a hand-off never leaves a gap in who can answer for a
 * record (ADR-0005). The destination list excludes the division the document is currently *at* —
 * which is not `document.divisionId` any more, that being where it was registered — because
 * forwarding a document to the unit already holding it is the one request here with no meaning.
 */
export function RouteDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const route = useRouteDocument(document.id);
  const divisions = useDivisions();

  const form = useForm<RouteDocumentInput>({
    resolver: zodResolver(routeDocumentSchema),
    defaultValues: {
      expectedVersion: document.version,
      toDivisionId: '',
      forInformationDivisionIds: [],
      remarks: '',
    },
  });

  const toDivisionId = form.watch('toDivisionId');
  const sections = useSections(toDivisionId || null);

  const custody = currentCustody(document);
  const active = (divisions.data ?? []).filter((division) => division.active);
  const destinations = active.filter((division) => division.id !== custody.divisionId);
  // The lead may not also be copied in — one division cannot both block progress and not block it
  // — so it leaves the list as soon as it is chosen, and any stale tick is dropped with it.
  const consultable = active.filter((division) => division.id !== toDivisionId);

  const onSubmit = (values: RouteDocumentInput) => {
    setFormError(null);
    route.mutate(
      { ...values, expectedVersion: document.version },
      {
        onSuccess: () => {
          setOpen(false);
          form.reset();
          toast.success('Document forwarded', {
            description: `${document.trackingNumber} now sits with the receiving division.`,
          });
        },
        onError: (error) => {
          if (error instanceof ApiError && error.isConflict) {
            setFormError('This document changed — review and retry.');
            return;
          }
          setFormError(applyServerErrors(form, error));
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Share2 />
          Forward
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <p className="eyebrow">{document.trackingNumber}</p>
          <DialogTitle>Forward to another division</DialogTitle>
          <DialogDescription>
            The receiving unit takes custody and gains access; whoever can see it now keeps it. The
            handoff is recorded with your name.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not forward</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="toDivisionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receiving division</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={(value) => {
                      field.onChange(value);
                      // The previously chosen section belongs to another division, and the new
                      // lead cannot stay ticked as a copy — the contract refuses that pairing.
                      form.setValue('toSectionId', undefined);
                      form.setValue(
                        'forInformationDivisionIds',
                        (form.getValues('forInformationDivisionIds') ?? []).filter(
                          (id) => id !== value,
                        ),
                      );
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a division" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {destinations.map((division) => (
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
              name="toSectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receiving section</FormLabel>
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
                  <FormDescription>
                    Leave at division level to let the receiving division assign it.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="forInformationDivisionIds"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Copy in for information (optional)</FormLabel>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border px-2 py-1.5">
                    {consultable.length === 0 ? (
                      <p className="text-muted-foreground text-sm">No other divisions.</p>
                    ) : (
                      consultable.map((division) => {
                        const selected = (field.value ?? []).includes(division.id);
                        return (
                          <label
                            key={division.id}
                            className="flex items-center gap-2 text-sm leading-6"
                          >
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(checked) =>
                                field.onChange(
                                  checked === true
                                    ? [...(field.value ?? []), division.id]
                                    : (field.value ?? []).filter((id) => id !== division.id),
                                )
                              }
                            />
                            {division.name}
                          </label>
                        );
                      })
                    )}
                  </div>
                  <FormDescription>
                    Copied divisions may read and remark. They do not hold the document and never
                    block it.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="remarks"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Remarks (optional)</FormLabel>
                  <FormControl>
                    <Textarea rows={3} maxLength={4000} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={route.isPending || toDivisionId === ''}>
                {route.isPending ? <Loader2 className="animate-spin" /> : null}
                Forward document
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
