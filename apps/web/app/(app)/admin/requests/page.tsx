import type { Metadata } from 'next';
import { AccountRequestsScreen } from '@/features/admin/account-requests-screen';
import { RequireCapability } from '@/features/session/require-capability';

export const metadata: Metadata = {
  title: 'Account requests · DTS',
};

export default function AccountRequestsPage() {
  return (
    <RequireCapability capability="ACCOUNT_REQUEST_REVIEW">
      <AccountRequestsScreen />
    </RequireCapability>
  );
}
