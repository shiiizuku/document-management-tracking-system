'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { loginSchema, type LoginInput } from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { applyServerErrors, safeNextPath } from '@/lib/forms';
import { useLogin } from './queries';

/**
 * The seeded pilot account, prefilled so a developer can sign in without looking it up.
 *
 * `NODE_ENV` is inlined at build time, so these literals are dead code in a production bundle and
 * the fields ship empty. That is decision 100: the seeded credentials exist for development and
 * must never be offered — or shipped — to a pilot user.
 */
const developmentDefaults: LoginInput =
  process.env.NODE_ENV === 'development'
    ? { email: 'records@dts.local', password: 'Records@1234!' }
    : { email: '', password: '' };

/**
 * `autoFocus` is on for the dedicated sign-in screen and off where the form shares a page with
 * other content (the landing page), where focusing a field would scroll past the headline.
 */
export function LoginForm({ autoFocus = true }: Readonly<{ autoFocus?: boolean }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    // The same schema the API validates with, so the client cannot accept a password the server
    // will reject on length alone.
    resolver: zodResolver(loginSchema),
    defaultValues: developmentDefaults,
  });

  const onSubmit = (values: LoginInput) => {
    setFormError(null);
    login.mutate(values, {
      // Back to wherever the expired session interrupted them, or the registry.
      onSuccess: () => router.replace(safeNextPath(searchParams.get('next'))),
      onError: (error) => setFormError(applyServerErrors(form, error)),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <div>
          <p className="eyebrow">Authorized access</p>
          <h2 className="mt-1 text-3xl">Sign in to the DTS</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use your organization-issued account.
          </p>
        </div>

        {formError === null ? null : (
          <Alert variant="destructive">
            <AlertCircle />
            <AlertTitle>Sign-in failed</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Email</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="username" autoFocus={autoFocus} {...field} />
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
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? <Loader2 className="animate-spin" /> : null}
          Sign in
          {login.isPending ? null : <ArrowRight />}
        </Button>

        <p className="text-xs text-muted-foreground">
          Access is monitored and recorded in the audit trail.
        </p>

        <p className="text-sm text-muted-foreground">
          No account yet?{' '}
          <Link
            href="/request-account"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Request access
          </Link>
        </p>
      </form>
    </Form>
  );
}
