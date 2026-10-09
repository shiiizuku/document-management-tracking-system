'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, FileSearch, Lock } from 'lucide-react';
import {
  documentDirectionSchema,
  documentPrioritySchema,
  workflowStatusSchema,
} from '@dts/contracts';
import type { DataTableColumn, SortState } from '@/components/dts/data-table';
import { EmptyState } from '@/components/dts/empty-state';
import { FilterBar, FilterCheckbox } from '@/components/dts/filter-bar';
import { PageHeader } from '@/components/dts/page-header';
import {
  PRIORITY_LABELS,
  PriorityLabel,
  StatusBadge,
  statusLabel,
} from '@/components/dts/status-badge';
import {
  useDivisions,
  useDocumentTypeLabel,
  useDocumentTypes,
  useSections,
} from '@/features/org/queries';
import { useSession } from '@/features/session/queries';
import { CreateDocumentDialog } from './create-document-dialog';
import { DeletedDocumentsDialog } from './deleted-documents-dialog';
import { DocumentList, ListViewControl } from './document-list';
import { useListView } from './list-view';
import {
  DOCUMENT_PAGE_SIZE,
  type DocumentListItem,
  type DocumentSortField,
  useInfiniteDocuments,
} from './queries';
import {
  documentFiltersToParams,
  hasActiveDocumentFilters,
  parseDocumentFilters,
} from './url-state';

const STATIC_FILTER_SELECTS = [
  {
    id: 'status',
    label: 'Status',
    anyLabel: 'Any status',
    options: workflowStatusSchema.options.map((value) => ({ value, label: statusLabel(value) })),
  },
  {
    id: 'priority',
    label: 'Priority',
    anyLabel: 'Any priority',
    options: documentPrioritySchema.options.map((value) => ({
      value,
      label: PRIORITY_LABELS[value],
    })),
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

/** Built per render so the type column reads the administrator's labels. */
const columnsFor = (
  typeLabel: (code: string) => string,
): readonly DataTableColumn<DocumentListItem>[] => [
  {
    id: 'title',
    header: 'Document',
    /*
     * The title is a real link as well as the row being clickable: the row click is a pointer
     * convenience, the link is what a keyboard, a middle-click or "open in new tab" can use.
     * Titles wrap to two lines and then truncate, so a long one cannot push the columns off.
     */
    cell: (row) => (
      <div className="min-w-0 max-w-[32rem] whitespace-normal">
        <div className="flex items-start gap-1.5">
          <Link
            href={`/documents/${row.id}`}
            onClick={(event) => event.stopPropagation()}
            className="line-clamp-2 font-semibold text-foreground hover:text-primary hover:underline focus-visible:underline focus-visible:outline-none"
          >
            {row.title}
          </Link>
          {row.confidential ? (
            <Lock
              className="mt-1 size-3.5 shrink-0 text-muted-foreground"
              aria-label="Confidential"
            />
          ) : null}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          <span className="tracking-number">{row.trackingNumber}</span>
          {` · ${typeLabel(row.type)}`}
          {row.referenceNumber === null ? '' : ` · ${row.referenceNumber}`}
        </div>
      </div>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    sortable: true,
    cell: (row) => <StatusBadge status={row.presentedStatus} />,
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
  // Per device and outside the URL, unlike every other control on this screen — see `list-view.ts`
  // for why a shared link must not carry it.
  const { view, setView } = useListView();

  const filters = parseDocumentFilters(searchParams);
  const documents = useInfiniteDocuments(filters);
  // The pages loaded so far, as one list. `total` is the server's count of the whole filtered set,
  // the same on every page, so the first one's is read.
  const rows = documents.data?.pages.flatMap((page) => page.items) ?? [];
  const total = documents.data?.pages[0]?.total;

  /*
   * The division list is a table, not an enum, so this select is built at render time. It exists
   * mainly because the dashboard's chart links straight to `?divisionId=…`: without a visible
   * control, the user would arrive at a filtered registry with no indication of what narrowed it.
   */
  const divisions = useDivisions();
  // Offered only once a division is chosen: a section belongs to one division, so there is nothing
  // meaningful to pick before that, and a stale section would silently empty the list.
  const sections = useSections(filters.divisionId || null);
  // Every type, retired ones included, because the registry still holds documents filed under them.
  const documentTypes = useDocumentTypes();
  const typeLabel = useDocumentTypeLabel();
  const columns = useMemo(() => columnsFor(typeLabel), [typeLabel]);
  const [statusSelect, prioritySelect, directionSelect] = STATIC_FILTER_SELECTS;
  const filterSelects = [
    statusSelect,
    prioritySelect,
    {
      id: 'type',
      label: 'Type',
      anyLabel: 'Any type',
      options: (documentTypes.data ?? []).map((type) => ({ value: type.code, label: type.label })),
    },
    directionSelect,
    {
      id: 'divisionId',
      /*
       * "Currently with", not "registered by". Forwarding is non-destructive (ADR-0005), so a
       * document's registering division never changes and the two readings diverge the first time
       * anything is forwarded; the server filters on current custody, which is also what the
       * dashboard chart counts. The label says so because the distinction is invisible otherwise.
       */
      label: 'Currently with',
      anyLabel: 'Any division',
      options: (divisions.data ?? []).map((division) => ({
        value: division.id,
        label: division.name,
      })),
    },
    ...(filters.divisionId === ''
      ? []
      : [
          {
            id: 'sectionId',
            label: 'Section',
            anyLabel: 'Any section',
            options: (sections.data ?? []).map((section) => ({
              value: section.id,
              label: section.name,
            })),
          },
        ]),
  ];

  // The draft follows the URL rather than owning it, so arriving at a filtered link — or pressing
  // Back — shows the search term that is actually applied.
  const [searchDraft, setSearchDraft] = useState(filters.search);
  useEffect(() => {
    setSearchDraft(filters.search);
  }, [filters.search]);

  const navigate = (nextFilters: typeof filters) => {
    const query = documentFiltersToParams(nextFilters);
    router.push(query === '' ? '/documents' : `/documents?${query}`, { scroll: false });
  };

  // Any change to what is being matched starts the list again from the top: a cursor belongs to
  // the list that issued it.
  const applyFilters = (patch: Partial<typeof filters>) => navigate({ ...filters, ...patch });

  const onSortChange = (sort: SortState) =>
    navigate({ ...filters, sort: sort.field as DocumentSortField, order: sort.order });

  return (
    <>
      <PageHeader
        eyebrow="Registry"
        title="Documents"
        count={total}
        actions={
          <>
            {/* Recovery sits beside the registry because that is the list a deleted document left,
                and it is the only way back to one. */}
            {can('DOCUMENT_RESTORE') ? <DeletedDocumentsDialog /> : null}
            {can('DOCUMENT_CREATE') ? <CreateDocumentDialog /> : null}
          </>
        }
      />

      <FilterBar
        search={{
          value: searchDraft,
          applied: filters.search,
          placeholder: 'Search title, tracking number, sender',
          onChange: setSearchDraft,
          onSubmit: () => applyFilters({ search: searchDraft }),
          onClear: () => applyFilters({ search: '' }),
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
          sectionId: filters.sectionId,
        }}
        // Changing the division drops the section: it belonged to the old one.
        onSelectChange={(id, value) =>
          applyFilters(id === 'divisionId' ? { divisionId: value, sectionId: '' } : { [id]: value })
        }
        // The overdue flag is not a select, so its chip is supplied here; it counts toward the
        // badge like any other filter.
        extraChips={
          filters.overdue
            ? [
                {
                  id: 'overdue',
                  label: 'Overdue',
                  onRemove: () => applyFilters({ overdue: false }),
                },
              ]
            : []
        }
        onClear={() => router.push('/documents', { scroll: false })}
        trailing={<ListViewControl view={view} onChange={setView} />}
        emptyResult={total === undefined ? undefined : total === 0}
      >
        <FilterCheckbox
          id="filter-overdue"
          label="Overdue only"
          checked={filters.overdue}
          onChange={(overdue) => applyFilters({ overdue })}
        />
      </FilterBar>

      <DocumentList
        view={view}
        caption="Documents in your authorized scope"
        columns={columns}
        rows={rows}
        total={total ?? 0}
        // Continuous list: the numbered-pager props are required by the shared shell and unused here.
        page={1}
        pageSize={DOCUMENT_PAGE_SIZE}
        onPageChange={() => undefined}
        more={{
          hasMore: documents.hasNextPage,
          isLoadingMore: documents.isFetchingNextPage,
          onLoadMore: () => void documents.fetchNextPage(),
        }}
        sort={{ field: filters.sort, order: filters.order }}
        onSortChange={onSortChange}
        onRowClick={(row) => router.push(`/documents/${row.id}`)}
        isLoading={documents.isPending}
        // Loading more must not dim the rows already on screen, only a refetch of them should.
        isFetching={documents.isFetching && !documents.isFetchingNextPage}
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
