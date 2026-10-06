import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentDetailScreen } from '../src/features/documents/document-detail-screen';
import type { DocumentDetail } from '../src/features/documents/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { division, documentDetail, sessionUser } from './fixtures';
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
    // The rail resolves route rows and the custody line to names through this list.
    if (path === '/divisions')
      return Promise.resolve([
        division({ id: 'division-1', name: 'Records Division' }),
        division({ id: 'division-2', name: 'Legal Division' }),
        division({ id: 'division-3', name: 'Finance Division' }),
      ]);
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
    expect(screen.getAllByText('Accept custody')).toHaveLength(2);
    expect(screen.getByText('Logged at the front desk.')).toBeInTheDocument();
  });

  it('shows nothing of the record while it loads', () => {
    apiMock.mockReturnValue(new Promise(() => undefined));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    expect(screen.queryByText('Incoming budget letter')).not.toBeInTheDocument();
  });

  /**
   * One route row, three shapes. Slice 4 records custody on the route — who it went to, whether
   * they accepted, and whether they were only copied — and until decision 174 the screen flattened
   * all of it to "Forwarded to another division". These are the three readings that has to produce.
   */
  const route = (overrides: Partial<DocumentDetail['routes'][number]> = {}) => ({
    id: 'route-1',
    fromDivisionId: 'division-1',
    toDivisionId: 'division-2',
    toSectionId: null,
    routedById: 'user-1',
    remarks: 'For legal review.',
    forInformation: false,
    acceptedAt: null,
    acceptedById: null,
    createdAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  });

  it('names the division a document was forwarded to, and carries the remark', async () => {
    serve(documentDetail({ routes: [route()] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Forwarded to Legal Division')).toBeInTheDocument(),
    );
    expect(screen.getByText('For legal review.')).toBeInTheDocument();
    // Nobody has accepted it, so there is no acceptance entry — which is what leaves it pending.
    expect(screen.queryByText(/^Accepted by/)).not.toBeInTheDocument();
  });

  it('shows an accepted hop as both the forward and the acceptance', async () => {
    serve(
      documentDetail({
        routes: [route({ acceptedAt: '2026-09-03T01:00:00.000Z', acceptedById: 'user-2' })],
      }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Forwarded to Legal Division')).toBeInTheDocument(),
    );
    expect(screen.getByText('Accepted by Legal Division')).toBeInTheDocument();
  });

  it('marks a for-information recipient as a copy and never as custody', async () => {
    serve(
      documentDetail({
        routes: [
          route(),
          route({ id: 'route-2', toDivisionId: 'division-3', forInformation: true, remarks: null }),
        ],
      }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Copied to Finance Division for information')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Forwarded to Finance Division')).not.toBeInTheDocument();
    // Custody is the most recent *lead* hop, so the copy does not move the document (decision 177).
    expect(screen.getByText('Legal Division')).toBeInTheDocument();
  });

  it('shows an acknowledged copy as an acknowledgement, not an acceptance', async () => {
    serve(
      documentDetail({
        routes: [
          route(),
          route({
            id: 'route-2',
            toDivisionId: 'division-3',
            forInformation: true,
            remarks: null,
            acceptedAt: '2026-09-03T01:00:00.000Z',
            acceptedById: 'user-3',
          }),
        ],
      }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() =>
      expect(screen.getByText('Acknowledged by Finance Division')).toBeInTheDocument(),
    );
    expect(screen.queryByText('Accepted by Finance Division')).not.toBeInTheDocument();
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

  /*
   * The server resolves the configured method and carrier to their labels, so this screen prints
   * what it is given rather than translating a code (policy register P-15), and the consignment
   * number is shown beside them, because a release that cannot be traced is not the same record.
   */
  it('prints the release method and carrier by their configured labels, with any tracking reference', async () => {
    serve(
      documentDetail({
        status: 'RELEASED',
        releaseMethod: {
          code: 'MAILED',
          label: 'Mailed',
          requiresCarrier: true,
          carrier: { code: 'LBC', label: 'LBC' },
          trackingReference: 'LBC-00042',
        },
      }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Released by')).toBeInTheDocument());
    expect(screen.getByText('Mailed')).toBeInTheDocument();
    expect(screen.getByText('Carrier')).toBeInTheDocument();
    expect(screen.getByText('LBC')).toBeInTheDocument();
    expect(screen.getByText('LBC-00042')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record carrier' })).not.toBeInTheDocument();
  });

  /*
   * A mailed release recorded before carriers were asked for (migration 0013). It says "not
   * recorded" rather than a dash, and only someone who may correct it is offered the correction.
   */
  const preCarrierRelease = () =>
    documentDetail({
      status: 'RELEASED',
      releaseMethod: {
        code: 'MAILED',
        label: 'Mailed',
        requiresCarrier: true,
        carrier: null,
        trackingReference: null,
      },
    });

  it('shows a missing carrier as not recorded, offering the correction to records staff', async () => {
    serve(
      preCarrierRelease(),
      sessionUser({ capabilities: ['DOCUMENT_RELEASE', 'DOCUMENT_RELEASE_CORRECT'] }),
    );
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Not recorded')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Record carrier' })).toBeInTheDocument();
  });

  it('does not offer the carrier correction without the capability', async () => {
    serve(preCarrierRelease(), sessionUser({ capabilities: ['DOCUMENT_RELEASE'] }));
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);

    await waitFor(() => expect(screen.getByText('Not recorded')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Record carrier' })).not.toBeInTheDocument();
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
  /*
   * The slip opens on screen and is exported only if someone presses Download inside it
   * (decision 170). The two go to different routes because the server audits them as different
   * actions, so the assertion is that the ordinary path requests the preview and nothing else.
   */
  it('opens the routing slip on screen before anything is exported', async () => {
    serve(documentDetail());
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Routing slip/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Routing slip/ }));

    await screen.findByRole('dialog');
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('downloads the routing slip from inside the preview, named after the tracking number', async () => {
    downloadMock.mockResolvedValue('routing-slip-DTS-2026-000001.pdf');
    serve(documentDetail());
    renderWithQuery(<DocumentDetailScreen documentId="doc-1" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Routing slip/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Routing slip/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Download' }));

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
