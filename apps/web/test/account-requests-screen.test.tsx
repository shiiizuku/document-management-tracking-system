import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountRequestsScreen } from '../src/features/admin/account-requests-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { DIVISION_ID, SECTION_ID, accountRequest, adminUser, division, section } from './fixtures';
import { calledPath, calledPaths, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const serve = (
  options: {
    requests?: ReturnType<typeof accountRequest>[] | Error;
    onApprove?: () => Promise<unknown>;
    onReject?: () => Promise<unknown>;
  } = {},
) => {
  const requests = options.requests ?? [accountRequest()];
  apiMock.mockImplementation((path: string) => {
    if (path === '/roles')
      return Promise.resolve([
        { role: 'STAFF_MEMBER', capabilities: ['DOCUMENT_COMPLY'], readsOfficeWide: false },
      ]);
    if (path === '/divisions') return Promise.resolve([division()]);
    if (path.startsWith('/sections')) return Promise.resolve([section()]);
    if (path.endsWith('/approve'))
      return options.onApprove?.() ?? Promise.resolve(adminUser({ role: 'VIEWER' }));
    if (path.endsWith('/reject'))
      return options.onReject?.() ?? Promise.resolve(accountRequest({ status: 'REJECTED' }));
    if (path.startsWith('/account-requests'))
      return requests instanceof Error ? Promise.reject(requests) : Promise.resolve(requests);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccountRequestsScreen', () => {
  it('opens on the pending queue rather than on every request ever made', async () => {
    serve();
    renderWithQuery(<AccountRequestsScreen />);

    await waitFor(() => expect(screen.getByText('Jose Rizal')).toBeInTheDocument());
    expect(calledPath(apiMock, (path) => path.startsWith('/account-requests'))).toBe(
      '/account-requests?status=PENDING',
    );
  });

  it('names the requested placement instead of showing ids', async () => {
    serve();
    renderWithQuery(<AccountRequestsScreen />);

    await waitFor(() => expect(screen.getByText('Records Division')).toBeInTheDocument());
  });

  it('explains an empty queue', async () => {
    serve({ requests: [] });
    renderWithQuery(<AccountRequestsScreen />);

    await waitFor(() => expect(screen.getByText('No requests are waiting')).toBeInTheDocument());
  });

  it('reports a failed queue rather than an empty one', async () => {
    serve({
      requests: new ApiError({ status: 500, code: 'HTTP_500', message: 'Queue unavailable' }),
    });
    renderWithQuery(<AccountRequestsScreen />);

    await waitFor(() => expect(screen.getByText('Queue unavailable')).toBeInTheDocument());
    expect(screen.queryByText('No requests are waiting')).not.toBeInTheDocument();
  });

  // The API refuses a second decision with a 409, so offering the buttons would teach reviewers
  // that the queue lies about what is still open.
  it('offers no decision on a request that was already reviewed', async () => {
    serve({ requests: [accountRequest({ status: 'APPROVED' })] });
    renderWithQuery(<AccountRequestsScreen />);

    await waitFor(() => expect(screen.getByText('Reviewed')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows why a request was rejected', async () => {
    serve({
      requests: [
        accountRequest({ status: 'REJECTED', rejectionReason: 'Not a member of this office.' }),
      ],
    });
    renderWithQuery(<AccountRequestsScreen />);

    await waitFor(() =>
      expect(screen.getByText('Not a member of this office.')).toBeInTheDocument(),
    );
  });

  // The default role is STAFF_MEMBER, which the contract's membership rules scope all the way down
  // to a section — so the form refuses to submit until one is chosen, before any request is made.
  it('refuses to approve a scoped role with no section, without asking the server', async () => {
    serve({ requests: [accountRequest({ requestedSectionId: null })] });
    renderWithQuery(<AccountRequestsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Approve and create/ }));

    expect(
      await screen.findByText('A section is required for the STAFF_MEMBER role'),
    ).toBeInTheDocument();
    expect(calledPaths(apiMock)).not.toContain('/account-requests/request-1/approve');
  });

  it('sends the role the reviewer chose, not the placement the applicant asked for', async () => {
    serve({ requests: [accountRequest({ requestedSectionId: SECTION_ID })] });
    renderWithQuery(<AccountRequestsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Approve and create/ }));

    await waitFor(() =>
      expect(calledPaths(apiMock)).toContain('/account-requests/request-1/approve'),
    );
    const body = requestBody(apiMock, '/account-requests/request-1/approve');
    expect(body).toMatchObject({
      role: 'STAFF_MEMBER',
      divisionId: DIVISION_ID,
      sectionId: SECTION_ID,
      canAccessConfidential: false,
    });
  });

  it('shows the applicant their own justification before the decision is made', async () => {
    serve();
    renderWithQuery(<AccountRequestsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Records intake duties for the Legal Division.');
  });

  it('puts a rejected field error from the server onto the form', async () => {
    serve({
      requests: [accountRequest({ requestedSectionId: SECTION_ID })],
      onApprove: () =>
        Promise.reject(
          new ApiError({
            status: 400,
            code: 'VALIDATION_FAILED',
            message: 'Validation failed',
            details: { fieldErrors: { sectionId: ['That section belongs to another division'] } },
          }),
        ),
    });
    renderWithQuery(<AccountRequestsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Approve and create/ }));

    expect(await screen.findByText('That section belongs to another division')).toBeInTheDocument();
  });

  // The reason is the only record of why an account does not exist, so it cannot be skipped.
  it('will not reject without a reason', async () => {
    serve();
    renderWithQuery(<AccountRequestsScreen />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reject request' })).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Not a member of this office.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject request' }));

    await waitFor(() =>
      expect(calledPaths(apiMock)).toContain('/account-requests/request-1/reject'),
    );
    expect(requestBody(apiMock, '/account-requests/request-1/reject')).toEqual({
      reason: 'Not a member of this office.',
    });
  });

  it('shows what the chosen role grants before the reviewer approves', async () => {
    serve();
    renderWithQuery(<AccountRequestsScreen />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByRole('group', { name: 'What Staff member grants' }),
    ).toHaveTextContent('Record as complied');
  });
});
