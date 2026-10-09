import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AwaitingAcceptance } from '../src/features/dashboard/awaiting-acceptance';
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
}) =>
  apiMock.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/auth/me')
      return Promise.resolve(
        sessionUser({
          capabilities: (options.capabilities ?? ['DOCUMENT_ACCEPT', 'DOCUMENT_ASSIGN']) as never,
        }),
      );
    if (path.startsWith('/documents?'))
      return Promise.resolve({
        items: options.items ?? [],
        total: options.total ?? (options.items ?? []).length,
        page: 1,
        pageSize: 20,
      });
    if (path === '/documents/doc-1/assignments' && init?.method === 'POST')
      return Promise.resolve(documentDetail());
    if (path === '/documents/doc-1')
      return Promise.resolve(
        documentDetail({ allowedActions: (options.allowedActions ?? ['ACCEPT']) as never }),
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
});
