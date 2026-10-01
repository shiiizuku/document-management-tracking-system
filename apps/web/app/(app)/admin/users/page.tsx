import type { Metadata } from 'next';
import { UsersScreen } from '@/features/admin/users-screen';
import { RequireCapability } from '@/features/session/require-capability';

export const metadata: Metadata = {
  title: 'Users · DTS',
};

export default function UsersPage() {
  return (
    <RequireCapability capability="USER_MANAGE">
      <UsersScreen />
    </RequireCapability>
  );
}
