'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { headOfBureauSchema, type HeadOfBureau } from '@dts/contracts';
import { Button } from '@/components/ui/button';
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
import { ConfirmDialog } from '@/components/dts/confirm-dialog';
import { applyServerErrors } from '@/lib/forms';
import { useHeadOfBureau, useUpdateHeadOfBureau } from './queries';

/**
 * Who every outgoing document is sent in the name of.
 *
 * The register form cannot change a sender on outgoing mail — the server stamps it from this
 * setting — so this is the one place the name is kept up to date. Saving asks first because the
 * change applies to every outgoing document registered from then on.
 */
export function HeadOfBureauCard() {
  const current = useHeadOfBureau();
  const update = useUpdateHeadOfBureau();
  const [pending, setPending] = useState<HeadOfBureau | null>(null);

  const form = useForm<HeadOfBureau>({
    resolver: zodResolver(headOfBureauSchema),
    defaultValues: { name: '', title: 'Regional Director' },
  });

  useEffect(() => {
    if (current.data !== undefined) form.reset(current.data);
  }, [current.data, form]);

  const save = async (values: HeadOfBureau) => {
    try {
      await update.mutateAsync(values);
      toast.success('Head of the Bureau updated');
    } catch (error) {
      // A field-level error lands on its input; anything else (offline, 5xx, no permission) comes
      // back as a message and must not vanish with the closing dialog.
      const message = applyServerErrors(form, error);
      if (message !== null)
        toast.error('Could not update the Head of the Bureau', { description: message });
    }
    setPending(null);
  };

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="font-display text-[22px] leading-tight text-foreground">
          Head of the Bureau
        </h2>
        <p className="text-sm text-muted-foreground">
          Every outgoing document is sent in this name. The sender cannot be changed per document.
        </p>
      </div>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit((values) => setPending(values))}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input maxLength={160} autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                  <Input maxLength={160} autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
            {update.isPending ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
          <FormDescription className="sm:col-span-3">
            Shown as &ldquo;Name, Title&rdquo;. Leave the name blank to show the title alone.
          </FormDescription>
        </form>
      </Form>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(next) => {
          if (!next) setPending(null);
        }}
        title="Change the Head of the Bureau?"
        description="Outgoing documents registered from now on will be sent in this name. Documents already registered keep the sender they have."
        confirmLabel="Change"
        busy={update.isPending}
        onConfirm={() => {
          if (pending !== null) void save(pending);
        }}
      >
        {pending === null ? null : (
          <p className="text-sm">
            {[pending.name, pending.title].filter((part) => part.trim() !== '').join(', ')}
          </p>
        )}
      </ConfirmDialog>
    </section>
  );
}
