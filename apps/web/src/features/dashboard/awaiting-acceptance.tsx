'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Inbox, Loader2, Network, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/dts/empty-state';
import { PriorityLabel, StatusBadge } from '@/components/dts/status-badge';
import { AssignDialog } from '@/features/documents/assign-dialog';
import {
  AssignSectionDialog,
  canAssignToSection,
} from '@/features/documents/assign-section-dialog';
import { DocumentActions } from '@/features/documents/document-actions';
import {
  DEFAULT_DOCUMENT_FILTERS,
  currentCustody,
  useDocument,
  useDocuments,
  type DocumentListItem,
} from '@/features/documents/queries';
import { useSession } from '@/features/session/queries';

/** How many rows the panel shows. The registry link below it is the way to the rest. */
const PANEL_ROWS = 5;

const PENDING_FILTERS = { ...DEFAULT_DOCUMENT_FILTERS, status: 'PENDING' };

/**
 * The documents waiting to be picked up, with the accepting and assigning done in place.
 *
 * Which rows appear is the registry's own `status=PENDING` answer, so this panel and the "Awaiting
 * acceptance" tile above it can never disagree. Which buttons a row offers is the server's: the
 * detail is fetched only for the row the user opens, and its `allowedActions` are rendered by the
 * same component the document page uses — so there is no second copy of the transition rules here.
 * Assigning is offered to anyone holding the capability; the server decides per document.
 *
 * Assigning to a section is the forward-to-section route (decision 156), offered only where the
 * document sits in the user's own division: a division hands work down to its own sections, and
 * sending it elsewhere is the Forward dialog's job.
 */
export function AwaitingAcceptance() {
  const pending = useDocuments(PENDING_FILTERS, 1);
  const rows = (pending.data?.items ?? []).slice(0, PANEL_ROWS);

  return (
    <section className="space-y-3" aria-label="Waiting for acceptance">
      <h2 className="font-display text-[26px] leading-tight text-foreground">
        Waiting for acceptance
      </h2>
      {pending.data === undefined ? null : rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing is waiting"
          description="No documents in your scope are awaiting acceptance."
          className="py-10"
        />
      ) : (
        <>
          <ul className="space-y-2">
            {rows.map((row) => (
              <PendingRow key={row.id} row={row} />
            ))}
          </ul>
          {pending.data.total > rows.length ? (
            <Link
              href="/documents?status=PENDING"
              className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
            >
              See all {pending.data.total.toLocaleString()} in the registry
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

function PendingRow({ row }: Readonly<{ row: DocumentListItem }>) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assigningSection, setAssigningSection] = useState(false);
  const { can, user } = useSession();
  const detail = useDocument(row.id, open);
  const canAssignSection =
    can('DOCUMENT_ASSIGN') &&
    detail.data !== undefined &&
    canAssignToSection(detail.data) &&
    user?.divisionId != null &&
    currentCustody(detail.data).divisionId === user.divisionId;

  return (
    <li className="rounded-2xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/documents/${row.id}`}
            className="block truncate font-semibold text-foreground hover:underline"
          >
            {row.title}
          </Link>
          <p className="truncate text-xs text-muted-foreground">
            {row.trackingNumber} · <PriorityLabel priority={row.priority} />
          </p>
        </div>
        <StatusBadge status={row.presentedStatus} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <ChevronUp /> : <ChevronDown />}
          {open ? 'Hide actions' : 'Take action'}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle pt-3">
          {detail.data === undefined ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Loading" />
          ) : (
            <DocumentActions document={detail.data} />
          )}
          {can('DOCUMENT_ASSIGN') ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setAssigning(true)}>
              <UserPlus />
              Assign
            </Button>
          ) : null}
          {canAssignSection ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setAssigningSection(true)}
            >
              <Network />
              Assign to section
            </Button>
          ) : null}
        </div>
      ) : null}

      {assigning ? (
        <AssignDialog
          documentId={row.id}
          trackingNumber={row.trackingNumber}
          open={assigning}
          onOpenChange={setAssigning}
        />
      ) : null}

      {assigningSection && detail.data !== undefined ? (
        <AssignSectionDialog
          document={detail.data}
          open={assigningSection}
          onOpenChange={setAssigningSection}
        />
      ) : null}
    </li>
  );
}
