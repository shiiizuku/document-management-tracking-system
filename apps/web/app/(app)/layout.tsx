import '../theme.css';
import { AppProviders } from '../../src/components/app-providers';

/*
 * The rebuilt UI. Owns the Tailwind/shadcn stylesheet and mounts the query cache, the
 * session-expiry handling and the toast surface. The shared shell (sidebar, topbar, session gate)
 * lands here in the remaining F0 tasks.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppProviders>{children}</AppProviders>;
}
