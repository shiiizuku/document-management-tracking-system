import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetailScreen } from '../src/features/documents/document-detail-screen';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail, sessionUser } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, downloadMock } = vi.hoisted(() => ({ apiMock: vi.fn(), downloadMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock, download: downloadMock };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/documents/doc-1',
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const serve = (detail: ReturnType<typeof documentDetail> | Error, user = sessionUser()): void => {
  apiMock.mockImplementation((path: string) => {
    if (path === '/auth/me') return Promise.resolve(user);
    if (path === '/documents/doc-1')
      return detail instanceof Error ? Promise.reject(detail) : Promise.resolve(detail);
    if (path.endsWith('/attachments')) return Promise.resolve([]);
    return Promise.resolve([]);
  });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('DocumentDetailScreen', () => {
  it('shows the document, its metadata and its timeline', async () => {
    serve(documentDetail());
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.getByText('DTS-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Regional Office')).toBeInTheDocument();
    // The action button and the timeline entry for the same action share one label, so the user
    // is not matching an enum name against the control they pressed.
    expect(screen.getAllByText('Accept & begin')).toHaveLength(2);
    expect(screen.getByText('Logged at the front desk.')).toBeInTheDocument();
  });

  it('shows nothing of the record while it loads', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    expect(screen.queryByText('Incoming budget letter')).not.toBeInTheDocument();
  });

  it('merges routing handoffs into the timeline in order', async () => {
    serve(
      documentDetail({
        routes: [
          {
            id: 'route-1',
            fromDivisionId: 'division-1',
            toDivisionId: 'division-2',
            toSectionId: null,
            routedById: 'user-1',
            remarks: 'For legal review.',
            createdAt: '2026-09-02T09:00:00.000Z',
          },
        ],
      }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Forwarded to another division')).toBeInTheDocument(),
    );
    expect(screen.getByText('For legal review.')).toBeInTheDocument();
  });

  it('says so when nothing has happened yet', async () => {
    serve(documentDetail({ timeline: [], routes: [] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText(/Nothing has happened to this document/)).toBeInTheDocument(),
    );
  });

  /*
   * A 403 and a 404 are shown identically on purpose: confirming that a tracking number exists
   * but is not readable by this account is itself a disclosure about documents outside its scope.
   */
  it.each([
    ['a missing document', 404],
    ['a document outside the reader’s scope', 403],
  ])('gives nothing away about %s', async (_label, status) => {
    serve(new ApiError({ status, code: `HTTP_${status}`, message: 'nope' }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('This document is not available')).toBeInTheDocument(),
    );
  });

  it('reports a transport failure as a failure, with its correlation id', async () => {
    serve(
      new ApiError({
        status: 500,
        code: 'HTTP_500',
        message: 'Database unavailable',
        correlationId: 'corr-12',
      }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Database unavailable')).toBeInTheDocument());
    expect(screen.getByText('corr-12')).toBeInTheDocument();
  });

  it('offers editing only to a user who may edit', async () => {
    serve(documentDetail(), sessionUser({ capabilities: [] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Edit metadata/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Forward/ })).not.toBeInTheDocument();
  });

  // A released or archived document is a closed record. The API refuses edits to it, so offering
  // them would only produce refusals.
  it('withdraws the edit controls once the record is closed', async () => {
    serve(documentDetail({ status: 'ARCHIVED', allowedActions: [] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Archived')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Edit metadata/ })).not.toBeInTheDocument();
  });

  it('marks a confidential document as such', async () => {
    serve(documentDetail({ confidential: true }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByLabelText('Confidential')).toBeInTheDocument());
  });

  /*
   * The routing slip is the dossier that travels stapled to the physical document, so it is offered
   * to anyone who can read the record — including on a closed one, which is exactly the document
   * whose printable copy people still need. The export is audited server-side.
   */
  it('downloads the routing slip, named after the tracking number', async () => {
    downloadMock.mockResolvedValue('routing-slip-DTS-2026-000001.pdf');
    serve(documentDetail());
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Routing slip/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Routing slip/ }));

    await waitFor(() =>
      expect(downloadMock).toHaveBeenCalledWith(
        '/documents/doc-1/routing-slip.pdf',
        'routing-slip-DTS-2026-000001.pdf',
      ),
    );
  });

  it('still offers the routing slip on a closed record', async () => {
    serve(documentDetail({ status: 'RELEASED', allowedActions: [] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Routing slip/ })).toBeInTheDocument(),
    );
  });

  it('withholds the delete control from a user without the capability', async () => {
    serve(documentDetail());
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('offers it to a user who holds DOCUMENT_DELETE', async () => {
    serve(documentDetail(), sessionUser({ capabilities: ['DOCUMENT_DELETE'] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument());
  });
});
