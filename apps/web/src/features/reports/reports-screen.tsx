'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, FileSpreadsheet, FileText, Loader2, NotebookText } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/dts/empty-state';
import { PageHeader } from '@/components/dts/page-header';
import { TableRowsSkeleton, TilesSkeleton } from '@/components/dts/skeletons';
import { documentTypeLabel } from '@/components/dts/status-badge';
import { MONTH_NAMES, monthName, useMonthlyReport, useReportDownload } from './queries';

/** Six years back is as far as the picker goes; anything older is a records-retention question. */
const YEARS_OFFERED = 6;

/**
 * The monthly register.
 *
 * Month and year are local state, not URL state — unlike the registry's filters. A report month
 * is a thing you flick through while looking at the totals, not a view you send to someone; the
 * artefact you send is the exported file, which carries its own period in its filename.
 */
export function ReportsScreen() {
  const now = new Date();
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);

  const report = useMonthlyReport(year, month);
  const exportFile = useReportDownload();

  const onExport = (format: 'xlsx' | 'pdf') =>
    exportFile.mutate(
      { format, year, month },
      {
        onSuccess: (filename) => toast.success(`Downloaded ${filename}`),
        onError: (error) =>
          toast.error('Export failed', {
            description: error instanceof Error ? error.message : 'Please try again.',
          }),
      },
    );

  const years = Array.from({ length: YEARS_OFFERED }, (_, index) => now.getUTCFullYear() - index);
  const totals = report.data?.totals;

  return (
    <>
      <PageHeader
        eyebrow="Reporting"
        title="Monthly register"
        description={`Documents registered in ${monthName(month)} ${year}, within the scope your account can read.`}
        actions={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={exportFile.isPending}
              onClick={() => onExport('xlsx')}
            >
              {exportFile.isPending && exportFile.variables?.format === 'xlsx' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileSpreadsheet />
              )}
              XLSX
            </Button>
            <Button type="button" disabled={exportFile.isPending} onClick={() => onExport('pdf')}>
              {exportFile.isPending && exportFile.variables?.format === 'pdf' ? (
                <Loader2 className="animate-spin" />
              ) : (
                <FileText />
              )}
              PDF
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-3">
        <div className="min-w-40">
          <Label htmlFor="report-month" className="mb-1.5 text-xs text-muted-foreground">
            Month
          </Label>
          <Select value={String(month)} onValueChange={(value) => setMonth(Number(value))}>
            <SelectTrigger id="report-month" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTH_NAMES.map((name, index) => (
                <SelectItem key={name} value={String(index + 1)}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-28">
          <Label htmlFor="report-year" className="mb-1.5 text-xs text-muted-foreground">
            Year
          </Label>
          <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
            <SelectTrigger id="report-year" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {report.error !== null ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>This report could not be produced</AlertTitle>
          <AlertDescription>
            <p>{report.error instanceof Error ? report.error.message : 'Something went wrong.'}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1"
              onClick={() => void report.refetch()}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : report.isPending ? (
        <TilesSkeleton />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile label="Incoming" value={totals?.incoming ?? 0} hint="Received this month" />
          <Tile label="Outgoing" value={totals?.outgoing ?? 0} hint="Issued this month" />
          <Tile
            label="FOI requests"
            value={totals?.foiRequests ?? 0}
            hint="Freedom of information"
          />
          <Tile label="Special orders" value={totals?.specialOrders ?? 0} hint="Orders issued" />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg text-foreground">
          Register entries{' '}
          {report.data === undefined ? null : (
            <span className="font-sans text-base text-muted-foreground tabular-nums">
              {report.data.totals.total}
            </span>
          )}
        </h2>

        {report.isPending ? (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableRowsSkeleton columns={4} rows={6} />
            </Table>
          </div>
        ) : (report.data?.documents ?? []).length === 0 ? (
          <EmptyState
            icon={NotebookText}
            title={`Nothing was registered in ${monthName(month)} ${year}`}
            description="Pick another month, or check that documents were registered under a division you can read."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <Table>
              <caption className="sr-only">
                Documents registered in {monthName(month)} {year}
              </caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="hidden sm:table-cell">Direction</TableHead>
                  <TableHead className="text-right">Registered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(report.data?.documents ?? []).map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <Link
                        href={`/documents/${entry.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {entry.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {entry.referenceNumber ?? entry.sender ?? entry.company ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {documentTypeLabel(entry.type)}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {entry.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}
                    </TableCell>
                    <TableCell className="text-right">
                      <time
                        dateTime={entry.createdAt}
                        className="text-sm text-muted-foreground tabular-nums"
                      >
                        {new Date(entry.createdAt).toLocaleDateString()}
                      </time>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}

function Tile({ label, value, hint }: Readonly<{ label: string; value: number; hint: string }>) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-foreground tabular-nums">
        {value.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </article>
  );
}
