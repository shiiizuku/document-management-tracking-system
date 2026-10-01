import { redirect } from 'next/navigation';

/*
 * There is no screen at the root. The registry is where work starts, so `/` sends the user there
 * and the session gate in the (app) group decides whether they get it or the login screen.
 *
 * F2 adds /dashboard and this becomes its destination.
 */
export default function RootPage() {
  redirect('/documents');
}
