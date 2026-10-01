'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { z } from 'zod';
import { submitAccountRequestSchema, type SubmitAccountRequestInput } from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Textarea } from '@/components/ui/textarea';
import { applyServerErrors } from '@/lib/forms';
import { useSubmitAccountRequest } from './queries';

/**
 * The public application for an account.
 *
 * The one form in the app that an unauthenticated stranger can submit, which shapes every decision
 * in it:
 *
 * The applicant chooses their own password, and it is validated here against the same
 * `strongPasswordSchema` the API enforces — so a rejected password is caught before a round trip,
 * and the policy is stated rather than guessed at.
 *
 * The division is typed, not picked from a list. `GET /divisions` needs a session, and exposing the
 * office's internal structure to anyone who loads a public page is a disclosure for no gain, so the
 * applicant says where they work in their own words and the reviewer decides the real placement.
 *
 * And success says the same thing whether or not the address already has an account. The API answers
 * identically in both cases on purpose, so this form cannot be used to find out who works here.
 */
type RequestFormValues = z.input<typeof submitAccountRequestSchema>;

export function RequestAccountForm() {
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const submit = useSubmitAccountRequest();

  const form = useForm<RequestFormValues, unknown, SubmitAccountRequestInput>({
    resolver: zodResolver(submitAccountRequestSchema),
    defaultValues: { email: '', displayName: '', password: '', justification: '' },
  });

  const onSubmit = (values: SubmitAccountRequestInput) => {
    setFormError(null);
    submit.mutate(values, {
      onSuccess: () => {
        setSubmitted(true);
        // Nothing typed here survives the submission: the form held a password.
        form.reset();
      },
      onError: (error) => setFormError(applyServerErrors(form, error)),
    });
  };

  if (submitted) {
    return (
      <div className="space-y-6">
        <Alert>
          <CheckCircle2 />
          <AlertTitle>Your request has been received</AlertTitle>
          <AlertDescription>
            <p>
              An administrator will review it and decide your role and placement. You will be able
              to sign in with the email address and password you chose once it is approved.
            </p>
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Request access</p>
        <h1 className="mt-1 font-serif text-3xl text-foreground">Apply for an account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Accounts are created by an administrator. Tell us who you are and why you need access.
        </p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
          {formError === null ? null : (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Your request could not be submitted</AlertTitle>
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
                  <Input maxLength={200} autoComplete="name" {...field} />
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
                <FormLabel>Work email</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="email" {...field} />
                </FormControl>
                <FormDescription>This becomes your sign-in name.</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Choose a password</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormDescription>
                  At least 12 characters, with an upper- and lowercase letter, a digit and a symbol.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="justification"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Why do you need access?</FormLabel>
                <FormControl>
                  <Textarea
                    rows={4}
                    maxLength={2000}
                    placeholder="Your division or section, your role, and what you will use the system for."
                    {...field}
                    value={field.value ?? ''}
                  />
                </FormControl>
                <FormDescription>
                  Name your division and section here — the reviewer uses this to place your
                  account.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={submit.isPending} className="w-full">
            {submit.isPending ? <Loader2 className="animate-spin" /> : null}
            Submit request
          </Button>
        </form>
      </Form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
