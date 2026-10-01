import type { Metadata } from 'next';
import { DashboardScreen } from '@/features/dashboard/dashboard-screen';

export const metadata: Metadata = {
  title: 'Dashboard · DTS',
};

/*
 * Ungated: every authenticated user gets a dashboard. There is nothing to gate on, because every
 * figure it shows is already scoped by the server to what this user may read.
 */
export default function DashboardPage() {
  return <DashboardScreen />;
}
