import type { Metadata } from 'next';
import { RequireCapability } from '@/features/session/require-capability';
import { ReportsScreen } from '@/features/reports/reports-screen';

export const metadata: Metadata = {
  title: 'Reports · DTS',
};

/*
 * Gated on REPORT_VIEW, the same capability the API enforces on `/reports/monthly`. The nav item
 * is hidden for a user without it; this is the second gate, for the user who has the link.
 */
export default function ReportsPage() {
  return (
    <RequireCapability capability="REPORT_VIEW">
      <ReportsScreen />
    </RequireCapability>
  );
}
