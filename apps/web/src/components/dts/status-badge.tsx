import type { DocumentPriority, WorkflowStatus } from '@dts/contracts';
import { ArrowUp } from 'lucide-react';
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
export type StatusTone = 'wait' | 'move' | 'done' | 'closed';

export const STATUS_TONE: Record<WorkflowStatus, StatusTone> = {
  PENDING: 'wait',
  FOR_REVISION: 'wait',
  // Waiting on a named authority to act, like For signature — not stalled, but not moving either.
  FOR_INITIAL: 'wait',
  IN_PROCESS: 'move',
  FOR_SIGNATURE: 'move',
  FOR_RELEASE: 'move',
  SIGNED: 'done',
  RELEASED: 'done',
  // The incoming counterpart to Released: the work is finished, the record is not yet closed.
  COMPLIED: 'done',
  ARCHIVED: 'closed',
};

const TONE_CLASSES: Record<StatusTone, string> = {
  wait: 'bg-signal-wait text-on-signal-wait',
  move: 'bg-signal-move text-on-signal-move',
  done: 'bg-signal-done text-on-signal-done',
  closed: 'bg-signal-closed text-on-signal-closed',
};

/*
 * A glyph per tone, so the four states read without colour: a ring for waiting, a filled dot for
 * moving, a check for done and a dash for closed. They are drawn in `currentColor`, so they take
 * the tone's text colour in both schemes, and they are hidden from assistive technology — the label
 * beside them already says the status, and "check mark, Signed" would say it twice.
 */
function ToneGlyph({ tone }: Readonly<{ tone: StatusTone }>) {
  switch (tone) {
    case 'wait':
      return (
        <span
          aria-hidden
          data-glyph="ring"
          className="size-1.5 shrink-0 rounded-full border-2 border-current box-content"
        />
      );
    case 'move':
      return (
        <span
          aria-hidden
          data-glyph="dot"
          className="size-[9px] shrink-0 rounded-full bg-current"
        />
      );
    case 'done':
      return (
        <svg
          aria-hidden
          data-glyph="check"
          viewBox="0 0 12 12"
          className="size-[11px] shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 6.5 4.75 9 10 3" />
        </svg>
      );
    case 'closed':
      return <span aria-hidden data-glyph="dash" className="h-0.5 w-[9px] shrink-0 bg-current" />;
  }
}

export function StatusBadge({
  status,
  className,
}: Readonly<{ status: WorkflowStatus; className?: string }>) {
  const tone = STATUS_TONE[status] as StatusTone | undefined;
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        tone === undefined ? 'bg-secondary text-secondary-foreground' : TONE_CLASSES[tone],
        className,
      )}
    >
      {tone === undefined ? null : <ToneGlyph tone={tone} />}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** `URGENT` reads as "Urgent". Sentence case, like every other label in the app. */
export const PRIORITY_LABELS: Record<DocumentPriority, string> = {
  URGENT: 'Urgent',
  HIGH: 'High',
  NORMAL: 'Normal',
  LOW: 'Low',
};

/**
 * Priority, emphasised only where it demands attention. Low and Normal stay quiet on purpose: if
 * every row is coloured, none of them stands out. High is set in the seal colour with an up-arrow;
 * Urgent is a red pill with an "!" — each has a glyph as well as a colour, for the same reason the
 * status badge does.
 */
export function PriorityLabel({ priority }: Readonly<{ priority: DocumentPriority }>) {
  const label = PRIORITY_LABELS[priority] ?? priority;
  if (priority === 'URGENT') {
    return (
      <span
        data-slot="priority-label"
        data-priority={priority}
        className="inline-flex items-center gap-1 rounded-full bg-priority-urgent-bg px-2.5 py-1 text-xs font-bold whitespace-nowrap text-priority-urgent"
      >
        <span aria-hidden className="leading-none font-extrabold">
          !
        </span>
        {label}
      </span>
    );
  }
  if (priority === 'HIGH') {
    return (
      <span
        data-slot="priority-label"
        data-priority={priority}
        className="inline-flex items-center gap-1 text-xs font-bold whitespace-nowrap text-seal-foreground"
      >
        <ArrowUp aria-hidden className="size-3.5" strokeWidth={2.75} />
        {label}
      </span>
    );
  }
  return (
    <span
      data-slot="priority-label"
      data-priority={priority}
      className="text-xs font-medium whitespace-nowrap text-muted-foreground"
    >
      {label}
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
