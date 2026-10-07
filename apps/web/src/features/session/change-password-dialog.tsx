'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';
import { strongPasswordSchema } from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { applyServerErrors } from '@/lib/forms';
import { useChangePassword } from './queries';

/**
 * The API's `changePasswordSchema` plus a confirmation, which only the browser needs: a typo in a
 * masked field would otherwise lock the person out of the account they just secured.
 */
const formSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(128),
    newPassword: strongPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((value) => value.confirmPassword === value.newPassword, {
    message: 'The passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    message: 'The new password must differ from the current one',
    path: ['newPassword'],
  });

type FormValues = z.infer<typeof formSchema>;

const EMPTY: FormValues = { currentPassword: '', newPassword: '', confirmPassword: '' };

/**
 * The signed-in user changes their own password (risk R-22). Every other session they hold ends,
 * which the success message says, so someone who changed it because a session was left open
 * somewhere knows that session is gone.
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const [formError, setFormError] = useState<string | null>(null);
  const change = useChangePassword();
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: EMPTY });

  const close = (next: boolean) => {
    // The form holds passwords. They do not survive a closed dialog.
    if (!next) {
      form.reset(EMPTY);
      setFormError(null);
    }
    onOpenChange(next);
  };

  const onSubmit = ({ currentPassword, newPassword }: FormValues) => {
    setFormError(null);
    change.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          close(false);
          toast.success('Password changed', {
            description: 'You are still signed in here. Every other session has been signed out.',
          });
        },
        onError: (error) => setFormError(applyServerErrors(form, error)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <p className="eyebrow">Your account</p>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Changing it signs you out everywhere else, on every other device and browser.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not change your password</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="currentPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Current password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormDescription>
                    At least 12 characters, with an upper- and lowercase letter, a digit and a
                    symbol.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirm new password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="new-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={change.isPending}>
                {change.isPending ? <Loader2 className="animate-spin" /> : null}
                Change password
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
