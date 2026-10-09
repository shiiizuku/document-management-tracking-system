import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwaitingAcceptance } from '../src/features/dashboard/awaiting-acceptance';
import { ApiError } from '../src/lib/api';
import type * as ApiModule from '../src/lib/api';
import { documentDetail, documentItem, sessionUser } from './fixtures';
import { calledPath, calledPaths, requestBody } from './mock-api';
import { renderWithQuery } from './query-harness';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const serve = (options: {
  items?: unknown[];
  total?: number;
  capabilities?: string[];
  allowedActions?: string[];
  userDivisionId?: string;
  routeStatus?: number;
  routes?: unknown[];
}) =>
  apiMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/auth/me')
      return Promise.resolve(
        sessionUser({
          capabilities: (options.capabilities ?? ['DOCUMENT_ACCEPT', 'DOCUMENT_ASSIGN']) as never,
          divisionId: options.userDivisionId ?? 'division-1',
        }),
      );
    if (path.startsWith('/documents?'))
      return Promise.resolve({
        items: options.items ?? [],
        total: options.total ?? (options.items ?? []).length,
        page: 1,
        pageSize: 20,
      });
    if (path === '/documents/doc-1/routes' && init?.method === 'POST')
      return options.routeStatus === 409
        ? Promise.reject(new ApiError({ status: 409, code: 'STALE_VERSION', message: 'Stale' }))
        : Promise.resolve(documentDetail());
    if (path.startsWith('/sections?'))
      return Promise.resolve([
        {
          id: 'sec-1',
          divisionId: 'division-1',
          code: 'GEN',
          name: 'General Section',
          active: true,
        },
        {
          id: 'sec-2',
          divisionId: 'division-1',
          code: 'OLD',
          name: 'Closed Section',
          active: false,
        },
        { id: 'sec-3', divisionId: 'division-1', code: 'LND', name: 'Lands Section', active: true },
      ]);
    if (path === '/documents/doc-1/assignments' && init?.method === 'POST')
      return Promise.resolve(documentDetail());
    if (path === '/documents/doc-1')
      return Promise.resolve(
        documentDetail({
          allowedActions: (options.allowedActions ?? ['ACCEPT']) as never,
          routes: (options.routes ?? []) as never,
        }),
      );
    if (path === '/users/assignable')
      return Promise.resolve([
        { id: 'user-9', displayName: 'Ana Dela Cruz', role: 'STAFF_MEMBER', divisionId: 'd1' },
      ]);
    return Promise.resolve([]);
  });

afterEach(() => {
  vi.clearAllMocks();
});

describe('AwaitingAcceptance', () => {
  it('asks the registry for pending documents and lists them as pending', async () => {
    serve({ items: [documentItem({ status: 'IN_PROCESS', presentedStatus: 'PENDING' })] });
    renderWithQuery(<AwaitingAcceptance />);

    await waitFor(() => expect(screen.getByText('Incoming budget letter')).toBeInTheDocument());
    expect(calledPath(apiMock, (path) => path.startsWith('/documents?'))).toContain(
      'status=PENDING',
    );
    expect(screen.getByText('En route')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    serve({ items: [] });
    renderWithQuery(<AwaitingAcceptance />);

    expect(await screen.findByText('Nothing is waiting')).toBeInTheDocument();
  });

  it('links to the rest when more than the panel shows are waiting', async () => {
    serve({ items: [documentItem()], total: 12 });
    renderWithQuery(<AwaitingAcceptance />);

    const link = await screen.findByRole('link', { name: /See all 12 in the registry/ });
    expect(link).toHaveAttribute('href', '/documents?status=PENDING');
  });

  it('loads the document and offers only the actions the server allows, once a row is opened', async () => {
    serve({ items: [documentItem()], allowedActions: ['ACCEPT'] });
    renderWithQuery(<AwaitingAcceptance />);
    await screen.findByText('Incoming budget letter');

    // Nothing is fetched for a row nobody opened.
    expect(calledPaths(apiMock)).not.toContain('/documents/doc-1');

    await userEvent.click(screen.getByRole('button', { name: /Take action/ }));

    expect(await screen.findByRole('button', { name: 'Accept custody' })).toBeInTheDocument();
    expect(calledPaths(apiMock)).toContain('/documents/doc-1');
  });

  it('assigns the document to the chosen person', async () => {
    serve({ items: [documentItem()] });
    renderWithQuery(<AwaitingAcceptance />);
    await screen.findByText('Incoming budget letter');
    await userEvent.click(screen.getByRole('button', { name: /Take action/ }));

    await userEvent.click(await screen.findByRole('button', { name: 'Assign' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Ana Dela Cruz/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));

    await waitFor(() =>
      expect(requestBody(apiMock, '/documents/doc-1/assignments', 'POST')).toEqual({
        recipientUserId: 'user-9',
      }),
    );
  });

  it('offers no Assign control to someone without the capability', async () => {
    serve({ items: [documentItem()], capabilities: ['DOCUMENT_ACCEPT'] });
    renderWithQuery(<AwaitingAcceptance />);
    await screen.findByText('Incoming budget letter');
    await userEvent.click(screen.getByRole('button', { name: /Take action/ }));

    await screen.findByRole('button', { name: 'Accept custody' });
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });

  describe('assign to a section', () => {
    const openDialog = async () => {
      await screen.findByText('Incoming budget letter');
      await userEvent.click(screen.getByRole('button', { name: /Take action/ }));
      await userEvent.click(await screen.findByRole('button', { name: 'Assign to section' }));
      return screen.findByRole('dialog');
    };

    it('forwards the lead hop to the chosen section of the holding division', async () => {
      serve({ items: [documentItem()] });
      renderWithQuery(<AwaitingAcceptance />);
      const dialog = await openDialog();

      await userEvent.click(within(dialog).getByRole('combobox'));
      // Inactive sections are not offered.
      expect(screen.queryByRole('option', { name: 'Closed Section' })).not.toBeInTheDocument();
      await userEvent.click(await screen.findByRole('option', { name: 'Lands Section' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign to section' }));

      await waitFor(() =>
        expect(requestBody(apiMock, '/documents/doc-1/routes', 'POST')).toEqual({
          expectedVersion: 3,
          toDivisionId: 'division-1',
          toSectionId: 'sec-3',
        }),
      );
    });

    it('does not offer the section the document already sits in', async () => {
      serve({
        items: [documentItem()],
        routes: [
          { id: 'r1', toDivisionId: 'division-1', toSectionId: 'sec-1', forInformation: false },
        ],
      });
      renderWithQuery(<AwaitingAcceptance />);
      const dialog = await openDialog();
      await userEvent.click(within(dialog).getByRole('combobox'));

      expect(await screen.findByRole('option', { name: 'Lands Section' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'General Section' })).not.toBeInTheDocument();
    });

    it('is not offered without the assign capability', async () => {
      serve({ items: [documentItem()], capabilities: ['DOCUMENT_ACCEPT'] });
      renderWithQuery(<AwaitingAcceptance />);
      await screen.findByText('Incoming budget letter');
      await userEvent.click(screen.getByRole('button', { name: /Take action/ }));

      await screen.findByRole('button', { name: 'Accept custody' });
      expect(screen.queryByRole('button', { name: 'Assign to section' })).not.toBeInTheDocument();
    });

    it('is not offered for a document held by another division', async () => {
      serve({ items: [documentItem()], userDivisionId: 'division-9' });
      renderWithQuery(<AwaitingAcceptance />);
      await screen.findByText('Incoming budget letter');
      await userEvent.click(screen.getByRole('button', { name: /Take action/ }));

      await screen.findByRole('button', { name: 'Assign' });
      expect(screen.queryByRole('button', { name: 'Assign to section' })).not.toBeInTheDocument();
    });

    it('reports a stale version and keeps the dialog open', async () => {
      const { toast } = await import('sonner');
      serve({ items: [documentItem()], routeStatus: 409 });
      renderWithQuery(<AwaitingAcceptance />);
      const dialog = await openDialog();
      await userEvent.click(within(dialog).getByRole('combobox'));
      await userEvent.click(await screen.findByRole('option', { name: 'Lands Section' }));
      await userEvent.click(within(dialog).getByRole('button', { name: 'Assign to section' }));

      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      const [title, detail] = vi.mocked(toast.error).mock.calls[0] ?? [];
      expect(title).toBe('Could not assign the document');
      expect(detail).toEqual({ description: 'This document changed — review it and try again.' });
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });
});
