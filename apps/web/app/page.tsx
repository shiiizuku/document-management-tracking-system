import { redirect } from 'next/navigation';

/*
 * There is no screen at the root. The dashboard is where a day starts, so `/` sends the user
 * there and the session gate in the (app) group decides whether they get it or the login screen.
 */
export default function RootPage() {
  redirect('/dashboard');
}
