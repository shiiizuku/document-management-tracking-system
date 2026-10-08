'use client';

import { Loader2 } from 'lucide-react';
import type { WorkflowAction } from '@dts/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
export function DocumentActions({
  document,
  placement = 'rail',
}: Readonly<{
  document: DocumentDetail;
  /**
   * `rail` is the plain row of buttons. `bar` is the detail page's "Your move" bar: the first
   * allowed action is the primary, in the bar's gold, and the rest are secondary. The order is the
   * server's, so "first" is whatever the server lists first — no ranking of actions happens here.
   */
  placement?: 'rail' | 'bar';
}>) {
  const runner = useActionRunner(document);

  if (document.allowedActions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No workflow actions are available to you on this document.
      </p>
    );
  }

  const variantFor = (action: WorkflowAction, index: number) => {
    if (isDestructiveAction(action)) return 'destructive' as const;
    if (placement === 'rail') return 'secondary' as const;
    return index === 0 ? ('default' as const) : ('outline' as const);
  };

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap gap-2',
          // On a narrow bar the buttons wrap to their own row, primary first and full width.
          placement === 'bar' && 'max-sm:w-full max-sm:flex-col max-sm:items-stretch',
        )}
      >
        {document.allowedActions.map((action, index) => (
          <Button
            key={action}
            type="button"
            variant={variantFor(action, index)}
            size={placement === 'bar' ? 'default' : 'sm'}
            disabled={runner.isPending}
            onClick={() => runner.start(action)}
            className={cn(
              placement === 'bar' &&
                !isDestructiveAction(action) &&
                (index === 0
                  ? 'bg-move-action font-bold text-move-action-foreground hover:bg-move-action/90'
                  : 'border border-sidebar-border bg-transparent text-move-bar-foreground hover:bg-sidebar-accent/40'),
            )}
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
