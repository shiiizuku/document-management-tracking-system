import { Skeleton } from '@/components/ui/skeleton';
import { TableBody, TableCell, TableRow } from '@/components/ui/table';

/*
 * Loading placeholders shaped like the content they stand in for. Shared so a slow list and a
 * slow detail panel look like the same app, and so `DataTable` and the routes agree on what a
 * pending row looks like.
 */

/**
 * Placeholder rows inside an already-rendered table. Column widths vary per row so the block
 * reads as text rather than as a grid of identical bars.
 */
export function TableRowsSkeleton({
  rows = 8,
  columns,
}: Readonly<{ rows?: number; columns: number }>) {
  return (
    <TableBody>
      {Array.from({ length: rows }, (_, row) => (
        <TableRow key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <TableCell key={column}>
              <Skeleton
                className="h-4"
                style={{ width: `${column === 0 ? 70 : 40 + ((row + column) % 3) * 12}%` }}
              />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </TableBody>
  );
}

/**
 * Placeholder cards, shaped like {@link DocumentCards}: an identity block, then a rule and a row
 * of short fields.
 */
export function CardsSkeleton({ count = 6 }: Readonly<{ count?: number }>) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-2xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="mt-1.5 h-3 w-1/2" />
          <div className="mt-3 flex gap-4 border-t border-border-subtle pt-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Placeholder lines, shaped like {@link DocumentLines}: one row of varying width each. */
export function LinesSkeleton({ rows = 10 }: Readonly<{ rows?: number }>) {
  return (
    <div className="divide-y divide-border-subtle" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-2">
          <Skeleton className="h-3.5 flex-1" style={{ maxWidth: `${55 + (index % 4) * 8}%` }} />
          <Skeleton className="hidden h-3 w-16 sm:block" />
          <Skeleton className="hidden h-3 w-12 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for a metadata panel: a heading, a few label/value pairs, a block of body text. */
export function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-3/4" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

/** Placeholder for a row of summary tiles. */
export function TilesSkeleton({ count = 4 }: Readonly<{ count?: number }>) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4" aria-hidden>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}
