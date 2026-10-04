'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ArrowRight, Check, FileText, ListFilter, Search, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type DemoRecord = {
  id: string;
  title: string;
  trackingNumber: string;
  sender: string;
  direction: 'Incoming' | 'Outgoing';
  status: 'Pending' | 'In process' | 'For signature' | 'Complied' | 'Archived';
  custody: string;
  priority: 'Normal' | 'High' | 'Urgent';
  registered: string;
  due: string;
  dueIso: string;
  dueState: 'Overdue' | 'Due today' | 'Upcoming' | 'Complete';
  assignedToMe: boolean;
  nextAction: string;
  summary: string;
};

// Fictional sample records. This route never requests, submits, or changes application data.
const records: readonly DemoRecord[] = [
  {
    id: 'demo-184',
    title: 'Regional operations summary',
    trackingNumber: 'DTS-2026-000184',
    sender: 'Operations Division',
    direction: 'Incoming',
    status: 'In process',
    custody: 'Planning Division',
    priority: 'Normal',
    registered: '1 Oct 2026',
    due: '3 Oct 2026',
    dueIso: '2026-10-03',
    dueState: 'Overdue',
    assignedToMe: true,
    nextAction: 'Record compliance',
    summary: 'A monthly summary awaiting a response from the Planning Division.',
  },
  {
    id: 'demo-183',
    title: 'Quarterly resource request',
    trackingNumber: 'DTS-2026-000183',
    sender: 'Planning Division',
    direction: 'Outgoing',
    status: 'For signature',
    custody: 'Office of the Director',
    priority: 'High',
    registered: '2 Oct 2026',
    due: '4 Oct 2026',
    dueIso: '2026-10-04',
    dueState: 'Due today',
    assignedToMe: true,
    nextAction: 'Review for signature',
    summary: 'The request has finished review and is waiting for the Director’s signature.',
  },
  {
    id: 'demo-182',
    title: 'Field activity memorandum',
    trackingNumber: 'DTS-2026-000182',
    sender: 'Field Office',
    direction: 'Incoming',
    status: 'Pending',
    custody: 'Records Section',
    priority: 'Urgent',
    registered: '3 Oct 2026',
    due: '6 Oct 2026',
    dueIso: '2026-10-06',
    dueState: 'Upcoming',
    assignedToMe: true,
    nextAction: 'Accept custody',
    summary: 'A new memorandum that has been routed to Records but not yet accepted.',
  },
  {
    id: 'demo-181',
    title: 'Interagency correspondence',
    trackingNumber: 'DTS-2026-000181',
    sender: 'Partner Agency',
    direction: 'Incoming',
    status: 'Complied',
    custody: 'Records Section',
    priority: 'Normal',
    registered: '29 Sep 2026',
    due: '30 Sep 2026',
    dueIso: '2026-09-30',
    dueState: 'Complete',
    assignedToMe: false,
    nextAction: 'Archive record',
    summary: 'The reply was recorded and the file is ready for archival.',
  },
  {
    id: 'demo-180',
    title: 'Approved travel authority',
    trackingNumber: 'DTS-2026-000180',
    sender: 'Administrative Division',
    direction: 'Outgoing',
    status: 'Archived',
    custody: 'Records Section',
    priority: 'Normal',
    registered: '25 Sep 2026',
    due: '27 Sep 2026',
    dueIso: '2026-09-27',
    dueState: 'Complete',
    assignedToMe: false,
    nextAction: 'View timeline',
    summary: 'An approved document preserved in the records archive.',
  },
];

type Section = 'registry' | 'work';
type ListView = 'table' | 'cards' | 'lines';

const sectionHref = (section: Section): string =>
  section === 'work' ? '/ui-draft?view=work' : '/ui-draft';
const recordHref = (id: string, section: Section): string =>
  `/ui-draft?record=${encodeURIComponent(id)}${section === 'work' ? '&view=work' : ''}`;

/** A standalone, read-only review surface using the selected UI treatment. */
export function UiDraft() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const record = records.find((item) => item.id === searchParams.get('record'));
  const section: Section = searchParams.get('view') === 'work' ? 'work' : 'registry';
  const query = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? 'all';
  const custody = searchParams.get('custody') ?? 'all';
  const [searchDraft, setSearchDraft] = useState(query);
  const [listView, setListView] = useState<ListView>('table');

  useEffect(() => setSearchDraft(query), [query]);
  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) setListView('cards');
  }, []);

  const updateFilters = (patch: { q?: string; status?: string; custody?: string }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('record');
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === 'all') params.delete(key);
      else params.set(key, value);
    }
    const suffix = params.toString();
    router.push(suffix === '' ? '/ui-draft' : `/ui-draft?${suffix}`);
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateFilters({ q: searchDraft.trim() });
  };

  const filtered = records.filter((item) => {
    if (section === 'work' && !item.assignedToMe) return false;
    if (status !== 'all' && item.status !== status) return false;
    if (custody !== 'all' && item.custody !== custody) return false;
    const term = query.trim().toLowerCase();
    return (
      term === '' ||
      [item.title, item.trackingNumber, item.sender].some((value) =>
        value.toLowerCase().includes(term),
      )
    );
  });
  const rows = section === 'work' ? [...filtered].sort(compareDue) : filtered;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              DTS
            </span>
            <div>
              <p className="font-semibold leading-tight">Records workspace</p>
              <p className="text-xs text-muted-foreground">Design preview</p>
            </div>
          </div>
          <Badge variant="outline">Draft · sample date 4 Oct 2026 · read only</Badge>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:py-8">
        <nav aria-label="Draft views" className="flex gap-2 lg:flex-col">
          <Button
            asChild
            variant={!record && section === 'registry' ? 'secondary' : 'ghost'}
            className="justify-start"
          >
            <Link href={sectionHref('registry')}>Registry</Link>
          </Button>
          <Button
            asChild
            variant={!record && section === 'work' ? 'secondary' : 'ghost'}
            className="justify-start"
          >
            <Link href={sectionHref('work')}>My work</Link>
          </Button>
        </nav>

        <main className="min-w-0 space-y-6">
          {record ? (
            <RecordDetail record={record} section={section} />
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold tracking-widest text-primary uppercase">
                    {section === 'work' ? 'Assigned to me' : 'Registry'}
                  </p>
                  <h1 className="mt-1 text-3xl font-semibold">
                    {section === 'work' ? 'My work' : 'Documents'}
                  </h1>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {section === 'work'
                      ? 'The next due item comes first. Select a record to see its next action.'
                      : 'Find a record by title, tracking number, or sender.'}
                  </p>
                </div>
                <Button
                  disabled
                  aria-label="Register document is unavailable in this read-only draft"
                >
                  Register document
                </Button>
              </div>

              <Card>
                <CardContent className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <form onSubmit={submitSearch} className="flex min-w-0 flex-1 gap-2">
                      <Label htmlFor="draft-search" className="sr-only">
                        Search records
                      </Label>
                      <Input
                        id="draft-search"
                        type="search"
                        value={searchDraft}
                        onChange={(event) => setSearchDraft(event.target.value)}
                        placeholder="Search title, tracking number, sender"
                      />
                      <Button type="submit" variant="secondary" aria-label="Search records">
                        <Search aria-hidden />
                        <span className="hidden sm:inline">Search</span>
                      </Button>
                    </form>
                    <AdvancedFilters
                      status={status}
                      custody={custody}
                      onStatusChange={(value) => updateFilters({ status: value })}
                      onCustodyChange={(value) => updateFilters({ custody: value })}
                    />
                  </div>

                  {(query || status !== 'all' || custody !== 'all') && (
                    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters">
                      <span className="text-xs text-muted-foreground">Active filters</span>
                      {query && (
                        <FilterChip
                          label={`Search: ${query}`}
                          onRemove={() => updateFilters({ q: '' })}
                        />
                      )}
                      {status !== 'all' && (
                        <FilterChip
                          label={status}
                          onRemove={() => updateFilters({ status: 'all' })}
                        />
                      )}
                      {custody !== 'all' && (
                        <FilterChip
                          label={custody}
                          onRemove={() => updateFilters({ custody: 'all' })}
                        />
                      )}
                      <Button asChild variant="link" size="sm">
                        <Link href={sectionHref(section)}>Clear all</Link>
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">
                    {rows.length} {rows.length === 1 ? 'record' : 'records'}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {section === 'work'
                      ? 'Ordered by due date'
                      : 'Fictional records for layout review'}
                  </p>
                </div>
                <div className="flex gap-1 rounded-md border p-1" aria-label="Record layout">
                  {(['table', 'cards', 'lines'] as const).map((view) => (
                    <Button
                      key={view}
                      type="button"
                      variant={listView === view ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-pressed={listView === view}
                      onClick={() => setListView(view)}
                      className="capitalize"
                    >
                      {view}
                    </Button>
                  ))}
                </div>
              </div>

              {rows.length === 0 ? (
                <Card>
                  <CardContent className="py-10 text-center">
                    <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden />
                    <h3 className="mt-3 font-semibold">No records match</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Try a broader search or remove a filter.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <RecordList records={rows} view={listView} section={section} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function AdvancedFilters({
  status,
  custody,
  onStatusChange,
  onCustodyChange,
}: {
  status: string;
  custody: string;
  onStatusChange: (value: string) => void;
  onCustodyChange: (value: string) => void;
}) {
  const count = Number(status !== 'all') + Number(custody !== 'all');
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline">
          <ListFilter aria-hidden />
          Filters{count > 0 ? ` (${count})` : ''}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filter records</SheetTitle>
          <SheetDescription>
            Search stays visible; these filters narrow the results.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4">
          <div className="space-y-2">
            <Label htmlFor="draft-status">Status</Label>
            <Select value={status} onValueChange={onStatusChange}>
              <SelectTrigger id="draft-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {(['Pending', 'In process', 'For signature', 'Complied', 'Archived'] as const).map(
                  (value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="draft-custody">Currently with</Label>
            <Select value={custody} onValueChange={onCustodyChange}>
              <SelectTrigger id="draft-custody" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any division</SelectItem>
                {['Planning Division', 'Office of the Director', 'Records Section'].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 py-1 text-xs">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} filter`}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <X className="size-3" aria-hidden />
      </button>
    </Badge>
  );
}

function RecordList({
  records: rows,
  view,
  section,
}: {
  records: DemoRecord[];
  view: ListView;
  section: Section;
}) {
  if (view === 'cards') {
    return (
      <ul className="grid gap-3 md:grid-cols-2">
        {rows.map((record) => (
          <li key={record.id}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>
                  <Link
                    href={recordHref(record.id, section)}
                    className="hover:underline focus-visible:underline"
                  >
                    {record.title}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {record.trackingNumber} · {record.direction}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={record.status} />
                <span className="text-muted-foreground">{record.custody}</span>
                <DueBadge record={record} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    );
  }

  if (view === 'lines') {
    return (
      <Card className="gap-0 py-0">
        <ul className="divide-y">
          {rows.map((record) => (
            <li key={record.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <Link
                href={recordHref(record.id, section)}
                className="min-w-0 flex-1 font-medium hover:underline focus-visible:underline"
              >
                {record.title}
              </Link>
              <StatusBadge status={record.status} />
              <DueBadge record={record} />
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <Table>
        <caption className="sr-only">Fictional document records</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Document</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden md:table-cell">Currently with</TableHead>
            <TableHead className="text-right">Due</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((record) => (
            <TableRow key={record.id}>
              <TableCell className="max-w-64 whitespace-normal">
                <Link
                  href={recordHref(record.id, section)}
                  className="font-medium text-foreground hover:underline focus-visible:underline"
                >
                  {record.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {record.trackingNumber} · {record.direction}
                </p>
              </TableCell>
              <TableCell>
                <StatusBadge status={record.status} />
              </TableCell>
              <TableCell className="hidden md:table-cell">{record.custody}</TableCell>
              <TableCell className="text-right">
                <DueBadge record={record} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function StatusBadge({ status }: { status: DemoRecord['status'] }) {
  return (
    <Badge variant={status === 'Archived' ? 'outline' : 'secondary'} className="text-xs">
      {status}
    </Badge>
  );
}

function DueBadge({ record }: { record: DemoRecord }) {
  if (record.dueState === 'Complete')
    return <span className="text-xs text-muted-foreground">Complete</span>;
  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <Badge
        variant={record.dueState === 'Overdue' ? 'destructive' : 'outline'}
        className="text-xs"
      >
        {record.dueState}
      </Badge>
      <span className="text-xs text-muted-foreground">{record.due}</span>
    </span>
  );
}

function RecordDetail({ record, section }: { record: DemoRecord; section: Section }) {
  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href={sectionHref(section)}>
          <ArrowLeft aria-hidden /> {section === 'work' ? 'My work' : 'Registry'}
        </Link>
      </Button>
      <div>
        <p className="text-xs font-semibold tracking-widest text-primary uppercase">
          {record.trackingNumber}
        </p>
        <h1 className="mt-1 text-3xl font-semibold">{record.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{record.summary}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>At a glance</CardTitle>
          <CardDescription>The details needed to decide what happens next.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryField label="Status">
            <StatusBadge status={record.status} />
          </SummaryField>
          <SummaryField label="Currently with">
            <span>{record.custody}</span>
          </SummaryField>
          <SummaryField label="Priority">
            <Badge variant={record.priority === 'Urgent' ? 'destructive' : 'outline'}>
              {record.priority}
            </Badge>
          </SummaryField>
          <SummaryField label="Due">
            <DueBadge record={record} />
          </SummaryField>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <Card className="h-fit lg:col-start-2 lg:row-start-1">
          <CardHeader>
            <CardTitle>Next action</CardTitle>
            <CardDescription>
              Shown beside the record on desktop and directly below the summary on mobile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Dialog>
              <DialogTrigger asChild>
                <Button className="w-full">
                  {record.nextAction}
                  <ArrowRight aria-hidden />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{record.nextAction}</DialogTitle>
                  <DialogDescription>
                    This is a UI draft. No workflow action will be submitted.
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  In the live screen, this dialog would show the fields required by the server for
                  this action.
                </p>
              </DialogContent>
            </Dialog>
            <p className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3" aria-hidden /> Preview only
            </p>
          </CardContent>
        </Card>

        <Card className="lg:col-start-1 lg:row-start-1">
          <CardHeader>
            <CardTitle>Record information</CardTitle>
            <CardDescription>Supporting metadata stays below the decision summary.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <SummaryField label="Sender">
                <span>{record.sender}</span>
              </SummaryField>
              <SummaryField label="Direction">
                <span>{record.direction}</span>
              </SummaryField>
              <SummaryField label="Registered">
                <span>{record.registered}</span>
              </SummaryField>
              <SummaryField label="Tracking number">
                <span>{record.trackingNumber}</span>
              </SummaryField>
            </div>
            <Separator />
            <p className="text-muted-foreground">
              Attachment preview and the full timeline would follow here in the live record. This
              draft contains no document bytes.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{children}</div>
    </div>
  );
}

const dueOrder: Record<DemoRecord['dueState'], number> = {
  Overdue: 0,
  'Due today': 1,
  Upcoming: 2,
  Complete: 3,
};

function compareDue(a: DemoRecord, b: DemoRecord): number {
  return dueOrder[a.dueState] - dueOrder[b.dueState] || a.dueIso.localeCompare(b.dueIso);
}
