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
 * The colours are the ones the bespoke stylesheet used, as literals rather than theme tokens:
 * they are a four-way traffic signal (waiting / moving / done / closed) with no equivalent in the
 * shadcn palette, and mapping them onto `primary`/`secondary` would collapse distinctions the
 * user reads at a glance.
 */

const STATUS_LABELS: Record<WorkflowStatus, string> = {
  PENDING: 'Pending',
  IN_PROCESS: 'In process',
  FOR_REVISION: 'For revision',
  FOR_SIGNATURE: 'For signature',
  SIGNED: 'Signed',
  FOR_RELEASE: 'For release',
  RELEASED: 'Released',
  ARCHIVED: 'Archived',
};

/** Waiting on someone, moving, complete, or closed. */
const STATUS_TONES: Record<WorkflowStatus, string> = {
  PENDING: 'bg-[#fff0cf] text-[#7f5a12]',
  FOR_REVISION: 'bg-[#fff0cf] text-[#7f5a12]',
  IN_PROCESS: 'bg-[#dce9f3] text-[#2e6082]',
  FOR_SIGNATURE: 'bg-[#dce9f3] text-[#2e6082]',
  FOR_RELEASE: 'bg-[#dce9f3] text-[#2e6082]',
  SIGNED: 'bg-[#dcefe5] text-[#236447]',
  RELEASED: 'bg-[#dcefe5] text-[#236447]',
  ARCHIVED: 'bg-[#e8e6e2] text-[#615d56]',
};

export function StatusBadge({
  status,
  className,
}: Readonly<{ status: WorkflowStatus; className?: string }>) {
  return (
    <span
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
  URGENT: 'text-[#a52c2c]',
  HIGH: 'text-[#a16b17]',
  NORMAL: 'text-muted-foreground',
  LOW: 'text-muted-foreground',
};

export function PriorityLabel({ priority }: Readonly<{ priority: DocumentPriority }>) {
  return <span className={cn('text-[10px] font-bold', PRIORITY_TONES[priority])}>{priority}</span>;
}

/** `FOI_REQUEST` reads as "FOI request"; `SPECIAL_ORDER` as "Special order". */
export const documentTypeLabel = (type: string): string => {
  if (type === 'FOI_REQUEST') return 'FOI request';
  const words = type.replaceAll('_', ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
