import type { Metadata } from 'next';
import { MyWorkScreen } from '@/features/documents/my-work-screen';

export const metadata: Metadata = {
  title: 'My work · DTS',
};

export default function MyWorkPage() {
  return <MyWorkScreen />;
}
