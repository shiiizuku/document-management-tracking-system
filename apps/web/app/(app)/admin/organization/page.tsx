import type { Metadata } from 'next';
import { OrganizationScreen } from '@/features/org/organization-screen';
import { RequireCapability } from '@/features/session/require-capability';

export const metadata: Metadata = {
  title: 'Divisions · DTS',
};

export default function OrganizationPage() {
  return (
    <RequireCapability capability="ORG_MANAGE">
      <OrganizationScreen />
    </RequireCapability>
  );
}
