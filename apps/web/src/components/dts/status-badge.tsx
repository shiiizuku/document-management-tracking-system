import type { DocumentPriority, WorkflowStatus } from '@dts/contracts';
import { cn } from '@/lib/utils';

/*
 * How a document's state is shown, in one place.
 *
 * Status and priority appear in the registry, on the detail page, in the assigned queue and in
 * the notification inbox. The mapping from an enum to words and a colour is a presentation
 * decision, and four screens making it independently is how "FOR_REVISION" ends up amber in one
 * list and grey in another.
 *
 * The colours are a four-way traffic signal — waiting / moving / done / closed — with no
 * equivalent in the shadcn palette; mapping them onto `primary`/`secondary` would collapse
 * distinctions the user reads at a glance. These status hues stay fixed in both themes.
 *
 * They were literal light-mode hex values until the dark scheme shipped, which left a Pending pill
 * as a pale cream blob on a near-black page and put URGENT at 2.73:1. The scale now lives in
 * theme.css as `--signal-*`, carries a value per scheme, and is reached through the
 * `signal-*` / `priority-*` utilities below — so a tone is changed in one place and both schemes
 * follow.
 */

const STATUS_LABELS: Record<WorkflowStatus, string> = {
  PENDING: 'Pending',
  IN_PROCESS: 'In process',
  FOR_REVISION: 'For revision',
  FOR_INITIAL: 'For initial',
  FOR_SIGNATURE: 'For signature',
  SIGNED: 'Signed',
  FOR_RELEASE: 'For release',
  RELEASED: 'Released',
  COMPLIED: 'Complied',
  ARCHIVED: 'Archived',
};

/** Waiting on someone, moving, complete, or closed. */
const STATUS_TONES: Record<WorkflowStatus, string> = {
  PENDING: 'bg-signal-wait text-on-signal-wait',
  FOR_REVISION: 'bg-signal-wait text-on-signal-wait',
  // Waiting on a named authority to act, like For signature — not stalled, but not moving either.
  FOR_INITIAL: 'bg-signal-wait text-on-signal-wait',
  IN_PROCESS: 'bg-signal-move text-on-signal-move',
  FOR_SIGNATURE: 'bg-signal-move text-on-signal-move',
  FOR_RELEASE: 'bg-signal-move text-on-signal-move',
  SIGNED: 'bg-signal-done text-on-signal-done',
  RELEASED: 'bg-signal-done text-on-signal-done',
  // The incoming counterpart to Released: the work is finished, the record is not yet closed.
  COMPLIED: 'bg-signal-done text-on-signal-done',
  ARCHIVED: 'bg-signal-closed text-on-signal-closed',
};

export function StatusBadge({
  status,
  className,
}: Readonly<{ status: WorkflowStatus; className?: string }>) {
  return (
    <span
      data-slot="status-badge"
      className={cn(
        'inline-block rounded-xl px-2 py-1 text-[10px] font-bold whitespace-nowrap',
        STATUS_TONES[status] ?? 'bg-secondary text-secondary-foreground',
        className,
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/**
 * Priority, coloured only where it demands attention. LOW and NORMAL stay in the body colour on
 * purpose: if every row is coloured, none of them stands out.
 */
const PRIORITY_TONES: Record<DocumentPriority, string> = {
  URGENT: 'text-priority-urgent',
  HIGH: 'text-priority-high',
  NORMAL: 'text-muted-foreground',
  LOW: 'text-muted-foreground',
};

export function PriorityLabel({ priority }: Readonly<{ priority: DocumentPriority }>) {
  return (
    <span
      data-slot="priority-label"
      className={cn('text-[10px] font-bold', PRIORITY_TONES[priority])}
    >
      {priority}
    </span>
  );
}

/** `FOI_REQUEST` reads as "FOI request"; `SPECIAL_ORDER` as "Special order". */
export const documentTypeLabel = (type: string): string => {
  if (type === 'FOI_REQUEST') return 'FOI request';
  // Two initialisms and a number that sentence-casing would mangle into "Denr 8888 action center".
  if (type === 'DENR_8888_ACTION_CENTER') return 'DENR 8888 Action Center';
  const words = type.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
