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
import { useDivisions, useSections } from '@/features/org/queries';
import { ApiError } from '@/lib/api';
import { applyServerErrors } from '@/lib/forms';
import { useRouteDocument, type DocumentDetail } from './queries';

/** Radix cannot hold `''` as a select value, and "the whole division" is a real choice. */
const NO_SECTION = '__none__';

/**
 * Forwards a document to another division or section.
 *
 * This moves the document's access scope, not just its label: whoever could see it because of
 * where it sat may lose it, and the receiving division gains it. The destination list therefore
 * excludes the division it already sits in — forwarding a document to itself is the one request
 * here with no meaning.
 */
export function RouteDialog({ document }: Readonly<{ document: DocumentDetail }>) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const route = useRouteDocument(document.id);
  const divisions = useDivisions();

  const form = useForm<RouteDocumentInput>({
    resolver: zodResolver(routeDocumentSchema),
    defaultValues: { expectedVersion: document.version, toDivisionId: '', remarks: '' },
  });

  const toDivisionId = form.watch('toDivisionId');
  const sections = useSections(toDivisionId || null);

  const destinations = (divisions.data ?? []).filter(
    (division) => division.id !== document.divisionId && division.active,
  );

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
            This changes who can see the document. The handoff is recorded with your name.
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
                      // The previously chosen section belongs to another division.
                      form.setValue('toSectionId', undefined);
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
