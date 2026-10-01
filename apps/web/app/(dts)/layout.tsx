import '../theme.css';
import { AppProviders } from '@/components/app-providers';

/*
 * The rebuilt UI — both the public screens (sign in, request an account) and the authenticated
 * app. It owns the Tailwind/shadcn stylesheet and mounts the query cache, the session-expiry
 * handling and the toast surface.
 *
 * Why this sits above the (public)/(app) split rather than in each group: the query cache must
 * survive the navigation from /login into the app. `useLogin` seeds the session into that cache
 * from the login response, and a provider mounted per group would be torn down on the way out of
 * /login — throwing the session away and making the shell wait on a second /auth/me.
 *
 * This layer exists only while the legacy `/` route still needs its own, conflicting stylesheet.
 * When globals.css goes (F1 step 7), the two imports below move into the root layout and this
 * group disappears. See docs/frontend-rebuild-plan.md.
 */
export default function DtsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppProviders>{children}</AppProviders>;
}
