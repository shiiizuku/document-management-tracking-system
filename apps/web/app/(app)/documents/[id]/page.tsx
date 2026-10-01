import type { Metadata } from 'next';
import { DocumentDetailScreen } from '@/features/documents/document-detail-screen';

export const metadata: Metadata = {
  title: 'Document · DTS',
};

/*
 * `params` is a promise in this version of Next, so the id is awaited here and handed to the
 * client screen as a plain string. Doing it in the page keeps the screen free of route plumbing,
 * and the screen testable without a router.
 */
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentDetailScreen documentId={id} />;
}
