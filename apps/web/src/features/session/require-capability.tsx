'use client';

import type { ReactNode } from 'react';
import { ShieldOff } from 'lucide-react';
import type { Capability } from '@dts/contracts';
import { EmptyState } from '@/components/dts/empty-state';
import { useSession } from './queries';

/**
 * Renders its children only for a user who holds `capability`.
 *
 * This is a courtesy, not a control: the API enforces the same capability on every request, and a
 * user who edits their way past this gate gets a 403. What it buys is that nobody is shown a
 * screen whose every action will be refused.
 *
 * It renders nothing at all while the session loads, so a capable user never sees the refusal
 * flash before their session resolves.
 */
export function RequireCapability({
  capability,
  children,
}: Readonly<{ capability: Capability; children: ReactNode }>) {
  const { isLoading, can } = useSession();
  if (isLoading) return null;
  if (!can(capability)) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="You do not have access to this area"
        description="Your account does not hold the permission this screen needs. Ask an administrator if you believe it should."
      />
    );
  }
  return children;
}
