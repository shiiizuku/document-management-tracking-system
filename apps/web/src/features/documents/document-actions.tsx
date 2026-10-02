'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ACTION_LABELS } from './action-labels';
import { useActionRunner, isDestructiveAction } from './use-action-runner';
import type { DocumentDetail } from './queries';

/**
 * The workflow controls for one document.
 *
 * Which buttons exist is the server's decision: it sends `allowedActions`, computed from the
 * document's status and this actor's capabilities, and this component renders exactly that list.
 * It never consults the status itself, which is what keeps the transition matrix in one place.
 *
 * Everything that happens after a press — the dialog for an action that needs input, the 409, the
 * toasts — belongs to `useActionRunner`, which the command palette shares. This file is the row of
 * buttons and nothing else.
 */
export function DocumentActions({ document }: Readonly<{ document: DocumentDetail }>) {
  const runner = useActionRunner(document);

  if (document.allowedActions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflow actions are available to you on this document.
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {document.allowedActions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={isDestructiveAction(action) ? 'destructive' : 'secondary'}
            size="sm"
            disabled={runner.isPending}
            onClick={() => runner.start(action)}
          >
            {runner.runningAction === action ? <Loader2 className="animate-spin" /> : null}
            {ACTION_LABELS[action]}
          </Button>
        ))}
      </div>

      {runner.dialog}
    </>
  );
}
