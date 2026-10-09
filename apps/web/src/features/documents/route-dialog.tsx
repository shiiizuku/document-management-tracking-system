'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  FOR_INFORMATION_RECIPIENT_LIMIT,
  routeDocumentSchema,
  type RouteDocumentInput,
} from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
 * Forwards a document to one lead division (optionally a section in it), copying any other ticked
 * divisions in for information.
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

  const copies = form.watch('forInformationDivisionIds') ?? [];

  const custody = currentCustody(document);
  const destinations = (divisions.data ?? []).filter(
    (division) => division.active && division.id !== custody.divisionId,
  );

  /*
   * One list of divisions, where a forward still names exactly one lead (decision 159): the first
   * division ticked is the lead and every later tick is a copy for information. Unticking the lead
   * promotes the next copy, so a forward with any tick always has a lead; "Make lead" swaps the two.
   * The section belongs to the lead's division, so it is cleared whenever the lead changes.
   */
  const setLead = (divisionId: string, nextCopies: string[]) => {
    form.setValue('toDivisionId', divisionId, { shouldValidate: form.formState.isSubmitted });
    form.setValue('toSectionId', undefined);
    form.setValue('forInformationDivisionIds', nextCopies);
  };
  const toggle = (divisionId: string, checked: boolean) => {
    if (checked) {
      if (toDivisionId === '') setLead(divisionId, copies);
      else form.setValue('forInformationDivisionIds', [...copies, divisionId]);
      return;
    }
    if (divisionId === toDivisionId) {
      const [next = '', ...rest] = copies;
      setLead(next, rest);
      return;
    }
    form.setValue(
      'forInformationDivisionIds',
      copies.filter((id) => id !== divisionId),
    );
  };
  // The contract caps the copies; at the cap, unticked divisions stop accepting a tick rather than
  // letting the form fail on submit with an error on a field the list has no slot to show.
  const copiesFull = toDivisionId !== '' && copies.length >= FOR_INFORMATION_RECIPIENT_LIMIT;
  const makeLead = (divisionId: string) =>
    setLead(divisionId, [toDivisionId, ...copies.filter((id) => id !== divisionId)]);

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
              render={() => (
                <FormItem>
                  <FormLabel id="route-divisions-label">Receiving divisions</FormLabel>
                  <div
                    role="group"
                    aria-labelledby="route-divisions-label"
                    className="max-h-64 divide-y divide-border-subtle overflow-y-auto rounded-xl border-[1.5px] border-input"
                  >
                    {destinations.length === 0 ? (
                      <p className="px-3.5 py-3 text-sm text-muted-foreground">
                        No other divisions.
                      </p>
                    ) : (
                      destinations.map((division) => {
                        const lead = division.id === toDivisionId;
                        const copied = copies.includes(division.id);
                        return (
                          <div
                            key={division.id}
                            className="flex min-h-11 items-center gap-2 pr-2 hover:bg-accent"
                          >
                            <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3 pl-3.5 text-[15px] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
                              <Checkbox
                                checked={lead || copied}
                                disabled={copiesFull && !lead && !copied}
                                onCheckedChange={(checked) => toggle(division.id, checked === true)}
                              />
                              {division.name}
                            </label>
                            {lead ? (
                              <Badge>Lead</Badge>
                            ) : copied ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => makeLead(division.id)}
                              >
                                Make lead
                              </Button>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                  <FormDescription>
                    The lead takes custody and must accept it. Every other ticked division is copied
                    in for information (up to {FOR_INFORMATION_RECIPIENT_LIMIT}): it may read and
                    remark, and never blocks the document.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {toDivisionId === '' ? null : (
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
                      Within the lead division. Leave at division level to let it assign the
                      document.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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

            <DialogFooter className="border-t border-border pt-4">
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
