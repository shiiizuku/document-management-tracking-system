import { Suspense } from 'react';
import type { Metadata } from 'next';
import { PublicAccessShell } from '@/components/dts/public-access-shell';
import { LoginForm } from '@/features/session/login-form';

export const metadata: Metadata = {
  title: 'Sign in · Document Tracking System',
};

export default function LoginPage() {
  return (
    <PublicAccessShell
      eyebrow="Government records operations"
      title="Every handoff stays on the record."
      description="Track custody, action, and release across one authoritative timeline."
      points={['Immutable versions', 'Scoped access', 'Audited actions']}
      action={{ href: '/request-account', label: 'Request access' }}
    >
      <Suspense fallback={<div className="h-96" />}>
        <LoginForm />
      </Suspense>
    </PublicAccessShell>
  );
}
