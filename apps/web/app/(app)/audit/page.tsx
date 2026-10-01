import { Suspense } from 'react';
import type { Metadata } from 'next';
import { AuditScreen } from '@/features/audit/audit-screen';
import { RequireCapability } from '@/features/session/require-capability';

export const metadata: Metadata = {
  title: 'Audit trail · DTS',
};

/*
 * The Suspense boundary is required rather than decorative: `AuditScreen` reads its filters with
 * `useSearchParams`, and Next refuses to prerender a client hook that depends on URL data unless
 * there is a boundary to fall back to.
 */
export default function AuditPage() {
  return (
    <RequireCapability capability="AUDIT_VIEW">
      <Suspense fallback={null}>
        <AuditScreen />
      </Suspense>
    </RequireCapability>
  );
}
