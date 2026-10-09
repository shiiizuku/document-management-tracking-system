import type { Metadata } from 'next';
import { DocumentTypesScreen } from '@/features/org/document-types-screen';
import { RequireCapability } from '@/features/session/require-capability';

export const metadata: Metadata = {
  title: 'Document types · DTS',
};

export default function DocumentTypesPage() {
  return (
    <RequireCapability capability="ORG_MANAGE">
      <DocumentTypesScreen />
    </RequireCapability>
  );
}
