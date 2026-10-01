'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, FileSearch, Lock } from 'lucide-react';
import {
  documentDirectionSchema,
  documentPrioritySchema,
  workflowStatusSchema,
} from '@dts/contracts';
import { DataTable, type DataTableColumn, type SortState } from '@/components/dts/data-table';
import { EmptyState } from '@/components/dts/empty-state';
import { FilterBar } from '@/components/dts/filter-bar';
import { PageHeader } from '@/components/dts/page-header';
import { PriorityLabel, StatusBadge, documentTypeLabel } from '@/components/dts/status-badge';
import { useDivisions } from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { CreateDocumentDialog } from './create-document-dialog';
import {
  DOCUMENT_PAGE_SIZE,
  DOCUMENT_TYPES,
  type DocumentListItem,
  type DocumentSortField,
  useDocuments,
} from './queries';
import {
  documentFiltersToParams,
  hasActiveDocumentFilters,
  parseDocumentFilters,
  parsePage,
} from './url-state';

const STATIC_FILTER_SELECTS = [
  {
    id: 'status',
    label: 'Status',
    anyLabel: 'Any status',
    options: workflowStatusSchema.options.map((value) => ({
      value,
      label: value.replaceAll('_', ' ').toLowerCase(),
    })),
  },
  {
    id: 'priority',
    label: 'Priority',
    anyLabel: 'Any priority',
    options: documentPrioritySchema.options.map((value) => ({ value, label: value })),
  },
  {
    id: 'type',
    label: 'Type',
    anyLabel: 'Any type',
    options: DOCUMENT_TYPES.map((value) => ({ value, label: documentTypeLabel(value) })),
  },
  {
    id: 'direction',
    label: 'Direction',
    anyLabel: 'Either direction',
    options: documentDirectionSchema.options.map((value) => ({
      value,
      label: value === 'INCOMING' ? 'Incoming' : 'Outgoing',
    })),
  },
] as const;

const columns: readonly DataTableColumn<DocumentListItem>[] = [
  {
    id: 'title',
    header: 'Document',
    cell: (row) => (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{row.title}</span>
          {row.confidential ? (
            <Lock className="size-3 shrink-0 text-muted-foreground" aria-label="Confidential" />
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground">
          {row.trackingNumber}
          {row.referenceNumber === null ? '' : ` · ${row.referenceNumber}`}
        </div>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    sortable: true,
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    id: 'priority',
    header: 'Priority',
    sortable: true,
    cell: (row) => <PriorityLabel priority={row.priority} />,
  },
  {
    id: 'direction',
    header: 'Direction',
    className: 'hidden md:table-cell',
    cell: (row) => (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        {row.direction === 'INCOMING' ? (
          <ArrowDownLeft className="size-3.5" aria-hidden />
        ) : (
          <ArrowUpRight className="size-3.5" aria-hidden />
        )}
        {row.direction === 'INCOMING' ? 'Incoming' : 'Outgoing'}
      </span>
    ),
  },
  {
    id: 'createdAt',
    header: 'Registered',
    sortable: true,
    align: 'end',
    className: 'hidden sm:table-cell',
    cell: (row) => (
      <time dateTime={row.createdAt} className="text-sm text-muted-foreground tabular-nums">
        {new Date(row.createdAt).toLocaleDateString()}
      </time>
    ),
  },
];

/**
 * The document registry.
 *
 * All of its state is in the URL, so a filtered view can be sent to a colleague, survives a
 * reload, and unwinds on the back button. The one exception is the search box's draft text: it
 * belongs to the keyboard, not to the address bar, and only reaches the URL on submit — pushing a
 * history entry per keystroke would make Back unusable.
 */
export function RegistryScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { can } = useSession();

  const filters = parseDocumentFilters(searchParams);
  const page = parsePage(searchParams);
  const documents = useDocuments(filters, page);

  /*
   * The division list is a table, not an enum, so this select is built at render time. It exists
   * mainly because the dashboard's chart links straight to `?divisionId=…`: without a visible
   * control, the user would arrive at a filtered registry with no indication of what narrowed it.
   */
  const divisions = useDivisions();
  const filterSelects = [
    ...STATIC_FILTER_SELECTS,
    {
      id: 'divisionId',
      label: 'Division',
      anyLabel: 'Any division',
      options: (divisions.data ?? []).map((division) => ({
        value: division.id,
        label: division.name,
      })),
    },
  ];

  // The draft follows the URL rather than owning it, so arriving at a filtered link — or pressing
  // Back — shows the search term that is actually applied.
  const [searchDraft, setSearchDraft] = useState(filters.search);
  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  const navigate = (nextFilters: typeof filters, nextPage: number) => {
    const query = documentFiltersToParams(nextFilters, nextPage);
    router.push(query === '' ? '/documents' : `/documents?${query}`, { scroll: false });
  };

  // Any change to what is being matched returns to page one: page 4 of the old result set is
  // rarely page 4 of the new one, and usually does not exist.
  const applyFilters = (patch: Partial<typeof filters>) => navigate({ ...filters, ...patch }, 1);

  const onSortChange = (sort: SortState) =>
    navigate({ ...filters, sort: sort.field as DocumentSortField, order: sort.order }, 1);

  return (
    <>
      <PageHeader
        eyebrow="Registry"
        title="Documents"
        count={documents.data?.total}
        actions={can('DOCUMENT_CREATE') ? <CreateDocumentDialog /> : null}
      />

      <FilterBar
        search={{
          value: searchDraft,
          placeholder: 'Search title, tracking number, sender',
          onChange: setSearchDraft,
          onSubmit: () => applyFilters({ search: searchDraft }),
        }}
        selects={filterSelects}
        // Only the dropdown filters: sort and order are the table's business, and search has its
        // own slot above.
        values={{
          status: filters.status,
          priority: filters.priority,
          type: filters.type,
          direction: filters.direction,
          divisionId: filters.divisionId,
        }}
        onSelectChange={(id, value) => applyFilters({ [id]: value })}
        onClear={() => router.push('/documents', { scroll: false })}
        hasOtherActiveFilters={hasActiveDocumentFilters(filters)}
      />

      <DataTable<DocumentListItem>
        caption="Documents in your authorized scope"
        columns={columns}
        rows={documents.data?.items ?? []}
        rowKey={(row) => row.id}
        total={documents.data?.total ?? 0}
        page={page}
        pageSize={DOCUMENT_PAGE_SIZE}
        onPageChange={(nextPage) => navigate(filters, nextPage)}
        sort={{ field: filters.sort, order: filters.order }}
        onSortChange={onSortChange}
        onRowClick={(row) => router.push(`/documents/${row.id}`)}
        isLoading={documents.isPending}
        isFetching={documents.isFetching}
        error={documents.error}
        onRetry={() => void documents.refetch()}
        empty={
          hasActiveDocumentFilters(filters) ? (
            <EmptyState
              icon={FileSearch}
              title="No documents match these filters"
              description="Try a broader search, or clear the filters to see everything in your scope."
              className="border-0 bg-transparent"
            />
          ) : (
            <EmptyState
              icon={FileSearch}
              title="No accessible documents yet"
              description="Documents you register, or that are routed or assigned to you, appear here."
              className="border-0 bg-transparent"
            />
          )
        }
      />
    </>
  );
}
