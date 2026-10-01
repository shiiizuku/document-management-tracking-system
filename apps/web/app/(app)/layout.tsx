import '../theme.css';

/*
 * The rebuilt UI. Owns the Tailwind/shadcn stylesheet; the shared shell (sidebar, topbar, session
 * gate, query client, toaster) lands here in the remaining F0 tasks.
 */
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
