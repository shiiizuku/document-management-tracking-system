import type { Metadata } from 'next';
import { PublicAccessShell } from '@/components/dts/public-access-shell';
import { RequestAccountForm } from '@/features/admin/request-account-form';

export const metadata: Metadata = {
  title: 'Request an account · Document Tracking System',
};

export default function RequestAccountPage() {
  return (
    <PublicAccessShell
      eyebrow="Account review"
      title="Access starts with a verified request."
      description="An administrator reviews every account, role, and organizational placement before access is granted."
      points={['Reviewed by a person', 'Least privilege', 'Decision recorded']}
      action={{ href: '/login', label: 'Sign in' }}
    >
      <RequestAccountForm />
    </PublicAccessShell>
  );
}
