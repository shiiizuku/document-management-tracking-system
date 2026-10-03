'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check, Inbox, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { z } from 'zod';
import {
  accountRequestStatusSchema,
  approveAccountRequestSchema,
  type ApproveAccountRequestInput,
} from '@dts/contracts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DataTable, type DataTableColumn } from '@/components/dts/data-table';
import { EmptyState } from '@/components/dts/empty-state';
import { FilterBar } from '@/components/dts/filter-bar';
import { PageHeader } from '@/components/dts/page-header';
import { useDivisions, useSections } from '@/features/org/queries';
import { applyServerErrors } from '@/lib/forms';
import { enumLabel } from '@/lib/utils';
import {
  useAccountRequests,
  useApproveAccountRequest,
  useRejectAccountRequest,
  type AccountRequest,
} from './queries';
import { RoleField, membershipNeeds } from './role-field';

/**
 * The account request queue.
 *
 * An applicant chose their own password and said which division they believe they belong to; an
 * administrator decides the role, confirms the placement, and decides whether confidential records
 * are in reach. Those four decisions are what approval *is*, which is why approving opens a form
 * rather than being a one-click confirmation — the applicant's requested placement is prefilled as a
 * suggestion, never accepted as a fact.
 *
 * Rejection is the other half and is deliberately just as deliberate: it requires a reason, because
 * the reason is recorded against the request and is the only thing a future reviewer has to explain
 * why an account does not exist.
 */

/** Radix cannot hold `''` as a select value, and "no section" is a real choice. */
const NO_SECTION = '__none__';

const STATUS_TONE: Record<AccountRequest['status'], 'secondary' | 'outline' | 'destructive'> = {
  PENDING: 'outline',
  APPROVED: 'secondary',
  REJECTED: 'destructive',
};

export function AccountRequestsScreen() {
  // Local state, not URL state, and the one list in the app where that is right: there is exactly
  // one filter, its default is the only view anyone works from, and nobody links to a review queue.
  const [status, setStatus] = useState<string>('PENDING');
  const [approving, setApproving] = useState<AccountRequest | null>(null);
  const [rejecting, setRejecting] = useState<AccountRequest | null>(null);

  const requests = useAccountRequests(status);
  const rows = requests.data ?? [];

  const columns: readonly DataTableColumn<AccountRequest>[] = [
    {
      id: 'applicant',
      header: 'Applicant',
      cell: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-foreground">{row.displayName}</div>
          <div className="truncate text-xs text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      id: 'requested',
      header: 'Requested placement',
      className: 'hidden lg:table-cell',
      cell: (row) => <RequestedPlacement request={row} />,
    },
    {
      id: 'createdAt',
      header: 'Submitted',
      className: 'hidden sm:table-cell whitespace-nowrap',
      cell: (row) => (
        <time dateTime={row.createdAt} className="text-sm text-muted-foreground tabular-nums">
          {new Date(row.createdAt).toLocaleDateString()}
        </time>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => (
        <div className="space-y-1">
          <Badge variant={STATUS_TONE[row.status]}>{enumLabel(row.status)}</Badge>
          {row.rejectionReason === null ? null : (
            <p className="max-w-60 text-xs text-muted-foreground">{row.rejectionReason}</p>
          )}
        </div>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Decision</span>,
      align: 'end',
      cell: (row) =>
        // A reviewed request keeps no controls: the API refuses a second decision with a 409, and
        // offering the buttons anyway would teach reviewers that the queue lies about what is open.
        row.status !== 'PENDING' ? (
          <span className="text-xs text-muted-foreground">Reviewed</span>
        ) : (
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" onClick={() => setApproving(row)}>
              <Check />
              Approve
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setRejecting(row)}>
              <X />
              Reject
            </Button>
          </div>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Account requests"
        count={requests.data?.length}
        description="Applications for access. Approving one creates the account with the role you choose."
      />

      <FilterBar
        selects={[
          {
            id: 'status',
            label: 'Status',
            anyLabel: 'Any status',
            options: accountRequestStatusSchema.options.map((option) => ({
              value: option,
              label: enumLabel(option),
            })),
          },
        ]}
        values={{ status }}
        onSelectChange={(_id, value) => setStatus(value)}
        onClear={() => setStatus('')}
      />

      <DataTable<AccountRequest>
        caption="Account requests awaiting a decision"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        // The endpoint returns the whole queue, so the pager reports one page of everything rather
        // than implying a server-side window that does not exist.
        total={rows.length}
        page={1}
        pageSize={Math.max(rows.length, 1)}
        onPageChange={() => undefined}
        isLoading={requests.isPending}
        isFetching={requests.isFetching}
        error={requests.error}
        onRetry={() => void requests.refetch()}
        empty={
          <EmptyState
            icon={Inbox}
            title={status === 'PENDING' ? 'No requests are waiting' : 'No requests match'}
            description={
              status === 'PENDING'
                ? 'Applications submitted from the public request form appear here.'
                : 'Choose a different status, or clear the filter to see every request.'
            }
            className="border-0 bg-transparent"
          />
        }
      />

      {approving === null ? null : (
        <ApproveDialog request={approving} onClose={() => setApproving(null)} />
      )}
      {rejecting === null ? null : (
        <RejectDialog request={rejecting} onClose={() => setRejecting(null)} />
      )}
    </>
  );
}

/**
 * What the applicant asked for, named rather than shown as ids.
 *
 * Reads the same cached division and section lists every other picker uses, so the reviewer sees
 * "Records Division · Intake" instead of two UUIDs — which is the difference between a decision and
 * a guess.
 */
function RequestedPlacement({ request }: Readonly<{ request: AccountRequest }>) {
  const divisions = useDivisions();
  const sections = useSections(request.requestedDivisionId);
  if (request.requestedDivisionId === null)
    return <span className="text-sm text-muted-foreground">None stated</span>;

  const division = (divisions.data ?? []).find((entry) => entry.id === request.requestedDivisionId);
  const section = (sections.data ?? []).find((entry) => entry.id === request.requestedSectionId);
  return (
    <span className="text-sm text-muted-foreground">
      {division?.name ?? request.requestedDivisionId}
      {section === undefined ? '' : ` · ${section.name}`}
    </span>
  );
}

/**
 * The approval decision.
 *
 * Resolved by `approveAccountRequestSchema` — the server's own schema — so the rule that a scoped
 * role needs a division, and the two lowest roles need a section, is enforced here by the same code
 * that enforces it at the API rather than by a second copy that can drift.
 */
type ApproveFormValues = z.input<typeof approveAccountRequestSchema>;

function ApproveDialog({
  request,
  onClose,
}: Readonly<{ request: AccountRequest; onClose: () => void }>) {
  const approve = useApproveAccountRequest();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<ApproveFormValues, unknown, ApproveAccountRequestInput>({
    resolver: zodResolver(approveAccountRequestSchema),
    defaultValues: {
      role: 'STAFF_MEMBER',
      // The applicant's own answer, as a starting point for a decision the reviewer still makes.
      divisionId: request.requestedDivisionId ?? undefined,
      sectionId: request.requestedSectionId ?? undefined,
      canAccessConfidential: false,
    },
  });

  const divisions = useDivisions();
  const divisionId = form.watch('divisionId');
  const sections = useSections(divisionId ?? null);
  // What the reviewer must supply depends on the role they just picked, so the labels follow it.
  const { division: needsDivision, section: needsSection } = membershipNeeds(form.watch('role'));

  const onSubmit = (values: ApproveAccountRequestInput) => {
    setFormError(null);
    approve.mutate(
      { id: request.id, decision: values },
      {
        onSuccess: (user) => {
          onClose();
          toast.success(`Approved ${user.displayName}`, {
            description: `The account is active as ${enumLabel(user.role)}.`,
          });
        },
        onError: (error) => setFormError(applyServerErrors(form, error)),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <p className="eyebrow">Approve request</p>
          <DialogTitle>{request.displayName}</DialogTitle>
          <DialogDescription>
            {request.email} · The applicant set their own password; approving creates the account
            immediately.
          </DialogDescription>
        </DialogHeader>

        {request.justification === null || request.justification === '' ? null : (
          <blockquote className="border-l-2 border-border pl-3 text-sm whitespace-pre-line text-muted-foreground">
            {request.justification}
          </blockquote>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
            {formError === null ? null : (
              <Alert variant="destructive">
                <AlertCircle />
                <AlertTitle>Could not approve this request</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <RoleField
              control={form.control}
              name="role"
              description="The role decides what this account may do. It is not what the applicant asked for."
            />

            <FormField
              control={form.control}
              name="divisionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Division{needsDivision ? '' : ' (optional)'}</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) => {
                      field.onChange(value === NO_SECTION ? undefined : value);
                      // The chosen section belongs to the old division and would be refused.
                      form.setValue('sectionId', undefined);
                    }}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a division" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>Office-wide (no division)</SelectItem>
                      {(divisions.data ?? []).map((division) => (
                        <SelectItem key={division.id} value={division.id}>
                          {division.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="sectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Section{needsSection ? '' : ' (optional)'}</FormLabel>
                  <Select
                    value={field.value ?? NO_SECTION}
                    onValueChange={(value) =>
                      field.onChange(value === NO_SECTION ? undefined : value)
                    }
                    disabled={(sections.data ?? []).length === 0}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={NO_SECTION}>
                        {(sections.data ?? []).length === 0
                          ? 'No sections'
                          : 'Division-level (no section)'}
                      </SelectItem>
                      {(sections.data ?? []).map((section) => (
                        <SelectItem key={section.id} value={section.id}>
                          {section.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="canAccessConfidential"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value ?? false}
                      onCheckedChange={(checked) => field.onChange(checked === true)}
                    />
                  </FormControl>
                  <div className="space-y-1">
                    <FormLabel>May open confidential documents</FormLabel>
                    <FormDescription>
                      Granted separately from the role, and audited. Leave clear unless the office
                      has decided otherwise.
                    </FormDescription>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={approve.isPending}>
                {approve.isPending ? <Loader2 className="animate-spin" /> : null}
                Approve and create account
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The rejection, with its reason.
 *
 * Plain state rather than react-hook-form: one required textarea with a length bound is not a form
 * whose validation needs a schema, and wiring one would be more code than the rule it enforces.
 */
function RejectDialog({
  request,
  onClose,
}: Readonly<{ request: AccountRequest; onClose: () => void }>) {
  const reject = useRejectAccountRequest();
  const [reason, setReason] = useState('');

  const onSubmit = () =>
    reject.mutate(
      { id: request.id, reason },
      {
        onSuccess: () => {
          onClose();
          toast.success('Request rejected', {
            description: 'The reason is recorded against the application.',
          });
        },
        onError: (error) =>
          toast.error('Could not reject this request', {
            description: error instanceof Error ? error.message : 'Please try again.',
          }),
      },
    );

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogHeader>
            <p className="eyebrow">Reject request</p>
            <DialogTitle>{request.displayName}</DialogTitle>
            <DialogDescription>
              No account is created. The reason below is kept with the application.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5 py-4">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              rows={4}
              maxLength={2000}
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={reject.isPending || reason.trim().length === 0}
            >
              {reject.isPending ? <Loader2 className="animate-spin" /> : null}
              Reject request
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
