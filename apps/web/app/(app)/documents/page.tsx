import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RegistryScreen } from '@/features/documents/registry-screen';

export const metadata: Metadata = {
  title: 'Documents · DTS',
};

/*
 * The registry keeps its filters and page in the URL, so it reads them with `useSearchParams` and
 * therefore needs a Suspense boundary to be prerenderable. The fallback is deliberately empty:
 * `DataTable` already renders its own skeleton once mounted, and a second, differently-shaped
 * placeholder in front of it would just be an extra flash.
 */
export default function DocumentsPage() {
  return (
    <Suspense>
      <RegistryScreen />
    </Suspense>
  );
}
