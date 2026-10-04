import { Suspense } from 'react';
import type { Metadata } from 'next';
import { UiDraft } from '@/features/ui-draft/ui-draft';

export const metadata: Metadata = {
  title: 'UI draft · DTS',
  description: 'Read-only UI draft with fictional document records.',
};

export default function UiDraftPage() {
  return (
    <Suspense>
      <UiDraft />
    </Suspense>
  );
}
