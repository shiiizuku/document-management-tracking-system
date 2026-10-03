import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetadataDialog } from '../src/features/documents/metadata-dialog';
import { RouteDialog } from '../src/features/documents/route-dialog';
import type { RouteEntry } from '../src/features/documents/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { documentDetail } from './fixtures';
import { requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const divisions = [
  { id: 'division-1', code: 'D1', name: 'Records Division', active: true },
  { id: 'division-2', code: 'D2', name: 'Legal Division', active: true },
];

/** Routes the org lookups, and lets a test decide what the write does. */
const serve = (onWrite: (path: string) => Promise<unknown>) =>
  apiMock.mockImplementation((path: string) => {
    if (path === '/divisions') return Promise.resolve(divisions);
    if (path.startsWith('/sections')) return Promise.resolve([]);
    if (path.endsWith('/metadata-revisions')) return Promise.resolve([]);
    return onWrite(path);
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe('MetadataDialog', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: /Edit metadata/ }));
    return screen.getByRole('dialog');
  };

  it('opens prefilled with what the document currently says', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<MetadataDialog document={documentDetail()} />);
    await open();

    expect(screen.getByLabelText('Title')).toHaveValue('Incoming budget letter');
    expect(screen.getByLabelText('Sender')).toHaveValue('Regional Office');
  });

  it('sends the edit with the version it was opened at', async () => {
    serve(() => Promise.resolve(documentDetail({ version: 4 })));
    renderWithQuery(<MetadataDialog document={documentDetail({ version: 3 })} />);
    const dialog = await open();

    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Corrected title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(requestBody(apiMock, '/documents/doc-1/metadata')).toMatchObject({
        title: 'Corrected title',
        expectedVersion: 3,
      }),
    );
  });

  // Empty text means "clear this field", and the API expresses that as null, not ''.
  it('clears an emptied field with null rather than an empty string', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<MetadataDialog document={documentDetail()} />);
    const dialog = await open();

    await userEvent.clear(screen.getByLabelText('Sender'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(requestBody(apiMock, '/documents/doc-1/metadata').sender).toBeNull(),
    );
  });

  it('validates with the API schema before sending anything', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<MetadataDialog document={documentDetail()} />);
    const dialog = await open();

    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(apiMock).not.toHaveBeenCalledWith('/documents/doc-1/metadata', expect.anything()),
    );
    expect(within(dialog).getByText(/Too small/i)).toBeInTheDocument();
  });

  /*
   * The stated recovery for a stale edit: say what happened, over a form whose document has
   * already been refetched, so the user can re-read and re-apply without reloading the page.
   */
  it('recovers a stale edit with "changed — review and retry"', async () => {
    serve(() =>
      Promise.reject(
        new ApiError({ status: 409, code: 'DOCUMENT_CONFLICT', message: 'Version conflict' }),
      ),
    );
    renderWithQuery(<MetadataDialog document={documentDetail()} />);
    const dialog = await open();

    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.type(screen.getByLabelText('Title'), 'Corrected title');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByText(/This document changed — review and retry/)).toBeInTheDocument(),
    );
    // Still open, with the user's text intact — there is nothing to retype.
    expect(screen.getByLabelText('Title')).toHaveValue('Corrected title');
  });

  it('puts a rejected field back on its own input', async () => {
    serve(() =>
      Promise.reject(
        new ApiError({
          status: 422,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { fieldErrors: { referenceNumber: ['Already used by another document'] } },
        }),
      ),
    );
    renderWithQuery(<MetadataDialog document={documentDetail()} />);
    const dialog = await open();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByText('Already used by another document')).toBeInTheDocument(),
    );
  });

  it('loads the revision history only when it is asked for', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<MetadataDialog document={documentDetail()} />);
    await open();

    expect(apiMock).not.toHaveBeenCalledWith('/documents/doc-1/metadata-revisions');

    await userEvent.click(screen.getByRole('button', { name: /Revision history/ }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/metadata-revisions'),
    );
  });
});

/** One custody hop, with the fields the dialog reads. */
const hop = (overrides: Partial<RouteEntry>): RouteEntry => ({
  id: 'route-1',
  fromDivisionId: null,
  toDivisionId: 'division-1',
  toSectionId: null,
  routedById: 'user-1',
  remarks: null,
  forInformation: false,
  acceptedAt: null,
  acceptedById: null,
  createdAt: '2026-09-02T09:00:00.000Z',
  ...overrides,
});

describe('RouteDialog', () => {
  const open = async () => {
    await userEvent.click(screen.getByRole('button', { name: /Forward/ }));
    return screen.getByRole('dialog');
  };

  /*
   * Forwarding a document to the unit already holding it is the one destination with no meaning,
   * so it is not offered. "Already holding it" is the last custody hop, not `divisionId`: that
   * column is where the document was registered and stops moving once it is forwarded
   * (ADR-0005). The fixture is registered in Legal and sitting in Records, so a dialog reading
   * the column would exclude exactly the wrong one.
   */
  it('does not offer the division currently holding the document', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(
      <RouteDialog
        document={documentDetail({
          divisionId: 'division-2',
          routes: [hop({ toDivisionId: 'division-1' })],
        })}
      />,
    );
    await open();

    await userEvent.click(screen.getByLabelText('Receiving division'));
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Legal Division' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('option', { name: 'Records Division' })).not.toBeInTheDocument();
  });

  it('forwards with the version it was opened at', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<RouteDialog document={documentDetail({ version: 3 })} />);
    const dialog = await open();

    await userEvent.click(screen.getByLabelText('Receiving division'));
    await userEvent.click(screen.getByRole('option', { name: 'Legal Division' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Forward document' }));

    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/documents/doc-1/routes', {
        method: 'POST',
        body: JSON.stringify({
          expectedVersion: 3,
          toDivisionId: 'division-2',
          forInformationDivisionIds: [],
          remarks: '',
        }),
      }),
    );
  });

  /*
   * A forward names one lead recipient and any number of divisions consulted for information
   * (decisions 159–160). The lead leaves the copy list the moment it is chosen, because a division
   * that both holds the document and is merely consulted is a contradiction the contract refuses.
   */
  it('copies other divisions in for information, never the lead', async () => {
    serve(() => Promise.resolve(documentDetail()));
    // Sitting in Legal, so Records is the destination on offer and Legal is only consultable.
    renderWithQuery(
      <RouteDialog document={documentDetail({ version: 2, divisionId: 'division-2' })} />,
    );
    const dialog = await open();

    await userEvent.click(within(dialog).getByLabelText('Legal Division'));
    await userEvent.click(screen.getByLabelText('Receiving division'));
    await userEvent.click(screen.getByRole('option', { name: 'Records Division' }));
    // Legal is still consultable — Records is the lead now — and its tick survived.
    expect(within(dialog).getByLabelText('Legal Division')).toBeChecked();
    expect(within(dialog).queryByLabelText('Records Division')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Forward document' }));

    await waitFor(() =>
      expect(requestBody(apiMock, '/documents/doc-1/routes')).toMatchObject({
        toDivisionId: 'division-1',
        forInformationDivisionIds: ['division-2'],
      }),
    );
  });

  it('drops a copied division that is then chosen as the lead', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<RouteDialog document={documentDetail({ version: 2 })} />);
    const dialog = await open();

    await userEvent.click(within(dialog).getByLabelText('Legal Division'));
    await userEvent.click(screen.getByLabelText('Receiving division'));
    await userEvent.click(screen.getByRole('option', { name: 'Legal Division' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Forward document' }));

    await waitFor(() =>
      expect(requestBody(apiMock, '/documents/doc-1/routes')).toMatchObject({
        toDivisionId: 'division-2',
        forInformationDivisionIds: [],
      }),
    );
  });

  it('will not forward without a destination', async () => {
    serve(() => Promise.resolve(documentDetail()));
    renderWithQuery(<RouteDialog document={documentDetail()} />);
    const dialog = await open();

    expect(within(dialog).getByRole('button', { name: 'Forward document' })).toBeDisabled();
  });

  it('reports a stale forward as "changed — review and retry"', async () => {
    serve(() =>
      Promise.reject(
        new ApiError({ status: 409, code: 'DOCUMENT_CONFLICT', message: 'Version conflict' }),
      ),
    );
    renderWithQuery(<RouteDialog document={documentDetail()} />);
    const dialog = await open();

    await userEvent.click(screen.getByLabelText('Receiving division'));
    await userEvent.click(screen.getByRole('option', { name: 'Legal Division' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Forward document' }));

    await waitFor(() =>
      expect(screen.getByText(/This document changed — review and retry/)).toBeInTheDocument(),
    );
  });
});
