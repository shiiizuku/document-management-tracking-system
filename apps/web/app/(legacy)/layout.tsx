import '../globals.css';

/*
 * Holds the pre-rebuild UI and its bespoke stylesheet. Each screen leaves this group as it is
 * rebuilt in F1; when the last one goes, this layout and globals.css are deleted together.
 */
export default function LegacyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
