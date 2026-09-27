const labels: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROCESS: 'In Process',
  FOR_REVISION: 'For Revision',
  FOR_SIGNATURE: 'For Signature',
  SIGNED: 'Signed',
  FOR_RELEASE: 'For Release',
  RELEASED: 'Released',
  ARCHIVED: 'Archived',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status status-${status.toLowerCase().replaceAll('_', '-')}`}>
      {labels[status] ?? status}
    </span>
  );
}
