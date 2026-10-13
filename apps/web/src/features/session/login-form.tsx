'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, ArrowRight, Eye, EyeOff } from 'lucide-react';
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
import { RouteLoader } from '@/components/dts/route-loader';
import { applyServerErrors, safeNextPath } from '@/lib/forms';
import { useLogin } from './queries';

/** Empty on purpose: seeded credentials are never offered, in development or anywhere else. */
const emptyDefaults: LoginInput = { email: '', password: '' };

/**
 * `autoFocus` is on for the dedicated sign-in screen and off where the form shares a page with
 * other content (the landing page), where focusing a field would scroll past the headline.
 */
export function LoginForm({ autoFocus = true }: Readonly<{ autoFocus?: boolean }>) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const login = useLogin();
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [transitionStage, setTransitionStage] = useState<'idle' | 'authenticating' | 'opening'>(
    'idle',
  );

  const form = useForm<LoginInput>({
    // The same schema the API validates with, so the client cannot accept a password the server
    // will reject on length alone.
    resolver: zodResolver(loginSchema),
    defaultValues: emptyDefaults,
  });

  const onSubmit = (values: LoginInput) => {
    setFormError(null);
    setTransitionStage('authenticating');
    login.mutate(values, {
      // Back to wherever the expired session interrupted them, or the registry.
      onSuccess: () => {
        setTransitionStage('opening');
        router.replace(safeNextPath(searchParams.get('next')));
      },
      onError: (error) => {
        setTransitionStage('idle');
        setFormError(applyServerErrors(form, error));
      },
    });
  };

  return (
    <div className="relative">
      {transitionStage === 'idle' ? null : (
        <RouteLoader
          overlay
          title={
            transitionStage === 'authenticating'
              ? 'Securing your session'
              : 'Opening your workspace'
          }
          detail={
            transitionStage === 'authenticating'
              ? 'Checking your credentials and authorized scope.'
              : 'Your dashboard is ready.'
          }
        />
      )}
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
                <div className="relative">
                  <FormControl>
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      className="pr-12"
                      {...field}
                    />
                  </FormControl>
                  <button
                    type="button"
                    onClick={() => setShowPassword((shown) => !shown)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-seal"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? 'Signing in' : 'Sign in'}
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
    </div>
  );
}
