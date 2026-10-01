'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AppShell } from '@/components/dts/app-shell';
import { useSession } from '@/features/session/queries';

/**
 * The session gate for every authenticated route.
 *
 * One probe here, one place that decides what to render before it answers. A route below this
 * can assume there is a signed-in user, which is what keeps the pages free of their own
 * loading-and-redirect preamble.
 *
 * There is deliberately no redirect in this file. A 401 — here or from any other request in the
 * app — is handled once in the QueryClient: it clears the cache and navigates to
 * `/login?next=<here>`. Duplicating that decision per layout is how two different answers to
 * "where do I send them" get shipped.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, isLoading, error, retry } = useSession();

  if (isLoading) return <SessionLoading />;

  // An expired session is already on its way to /login, so the only error left to show is one
  // signing in again will not fix: the API is unreachable or broken.
  if (error !== null && user === null) return <SessionUnavailable onRetry={retry} />;

  // The redirect is in flight. Rendering the shell for half a frame would flash a chrome the
  // user is not entitled to.
  if (!user) return null;

  return <AppShell user={user}>{children}</AppShell>;
}

function SessionLoading() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div
        className="size-8 animate-spin rounded-full border-3 border-secondary border-t-primary"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

function SessionUnavailable({ onRetry }: Readonly<{ onRetry: () => void }>) {
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Alert variant="destructive" className="max-w-md">
        <AlertCircle />
        <AlertTitle>Cannot reach the document service</AlertTitle>
        <AlertDescription>
          <p>Your session could not be confirmed. Check your connection and try again.</p>
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-1">
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  );
}
