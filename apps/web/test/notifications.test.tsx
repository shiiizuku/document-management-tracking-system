import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationsSheet } from '../src/features/notifications/notifications-sheet';
import { relativeTime } from '../src/features/notifications/queries';
import type * as ApiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { notification } from './fixtures';
import { renderWithQuery } from './query-harness';

const { apiMock, pushMock, toastError } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  pushMock: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof ApiModule>('../src/lib/api');
  return { ...actual, api: apiMock };
});

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock, replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }));

/** Serves the inbox, and lets a test decide what the mark-read calls do. */
const serveInbox = (
  items: ReturnType<typeof notification>[],
  unreadCount: number,
  onWrite: (path: string) => Promise<unknown> = () => Promise.resolve(null),
) =>
  apiMock.mockImplementation((path: string) => {
    if (path === '/notifications') return Promise.resolve({ items, nextCursor: null, unreadCount });
    return onWrite(path);
  });

const openSheet = async () => {
  await userEvent.click(screen.getByRole('button', { name: /Notifications/ }));
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('NotificationsSheet', () => {
  it('shows the unread count on the trigger without being opened', async () => {
    serveInbox([notification()], 1);
    renderWithQuery(<NotificationsSheet live />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 1 unread' })).toBeInTheDocument(),
    );
  });

  it('lists the inbox once opened', async () => {
    serveInbox([notification()], 1);
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();

    await waitFor(() => expect(screen.getByText('Document assigned')).toBeInTheDocument());
    expect(screen.getByText('DTS-2026-000001: Incoming budget letter')).toBeInTheDocument();
    expect(screen.getByText('Unread')).toBeInTheDocument();
  });

  it('explains an empty inbox', async () => {
    serveInbox([], 0);
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();

    await waitFor(() => expect(screen.getByText('Nothing yet')).toBeInTheDocument());
  });

  it('reports a failed inbox', async () => {
    apiMock.mockRejectedValue(
      new ApiError({ status: 500, code: 'HTTP_500', message: 'Inbox unavailable' }),
    );
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();

    await waitFor(() => expect(screen.getByText('Inbox unavailable')).toBeInTheDocument());
  });

  /*
   * The badge has to react to the click, not to the round trip — that is the whole point of the
   * optimistic update.
   */
  it('drops the badge before the server answers', async () => {
    let resolveWrite: (() => void) | undefined;
    serveInbox(
      [notification()],
      1,
      () => new Promise<unknown>((resolve) => (resolveWrite = () => resolve(null))),
    );
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();
    await waitFor(() => expect(screen.getByText('Document assigned')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Document assigned'));

    await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument());
    expect(resolveWrite).toBeDefined();
  });

  /*
   * And it has to go back up if the server refused, or the user is left believing they have read
   * something that is still waiting for them.
   */
  it('puts the unread state back when the server refuses', async () => {
    serveInbox([notification({ documentId: null })], 1, () =>
      Promise.reject(new ApiError({ status: 500, code: 'HTTP_500', message: 'nope' })),
    );
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();
    await waitFor(() => expect(screen.getByText('Document assigned')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Document assigned'));

    await waitFor(() => expect(screen.getByText('Unread')).toBeInTheDocument());
  });

  /*
   * Modelled with a mutable server, because the mutation reconciles with a refetch when it
   * settles: an inbox that kept answering "unread" would hide a missing write behind the
   * optimistic edit.
   */
  it('marks everything read in one go, and the refetch agrees', async () => {
    const paths: string[] = [];
    let readAt: string | null = null;
    apiMock.mockImplementation((path: string) => {
      if (path === '/notifications')
        return Promise.resolve({
          items: [notification({ readAt }), notification({ id: 'notification-2', readAt })],
          nextCursor: null,
          unreadCount: readAt === null ? 2 : 0,
        });
      paths.push(path);
      readAt = '2026-09-10T12:00:00.000Z';
      return Promise.resolve({ marked: 2 });
    });

    renderWithQuery(<NotificationsSheet live />);
    await openSheet();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Mark all read/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Mark all read/ }));

    await waitFor(() => expect(paths).toContain('/notifications/read-all'));
    await waitFor(() => expect(screen.queryByText('Unread')).not.toBeInTheDocument());
  });

  it('restores the whole inbox when marking everything read fails', async () => {
    serveInbox([notification()], 1, () =>
      Promise.reject(new ApiError({ status: 500, code: 'HTTP_500', message: 'nope' })),
    );
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Mark all read/ })).toBeInTheDocument(),
    );

    await userEvent.click(screen.getByRole('button', { name: /Mark all read/ }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByText('Unread')).toBeInTheDocument();
  });

  it('opens the document a notification is about', async () => {
    serveInbox([notification()], 1);
    renderWithQuery(<NotificationsSheet live />);
    await openSheet();
    await waitFor(() => expect(screen.getByText('Document assigned')).toBeInTheDocument());

    await userEvent.click(screen.getByText('Document assigned'));

    expect(pushMock).toHaveBeenCalledWith('/documents/doc-1');
  });

  // "Nothing has happened" and "this tab stopped listening" look identical otherwise, and the
  // second one makes a stale inbox look trustworthy.
  it('says whether it is still listening', async () => {
    serveInbox([], 0);
    const { unmount } = renderWithQuery(<NotificationsSheet live />);
    await openSheet();
    await waitFor(() => expect(screen.getByText('Live')).toBeInTheDocument());
    unmount();

    renderWithQuery(<NotificationsSheet live={false} />);
    await openSheet();
    await waitFor(() => expect(screen.getByText('Offline')).toBeInTheDocument());
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-09-10T12:00:00.000Z').getTime();

  it.each([
    ['2026-09-10T11:59:50.000Z', 'just now'],
    ['2026-09-10T11:45:00.000Z', '15m ago'],
    ['2026-09-10T09:00:00.000Z', '3h ago'],
    ['2026-09-08T12:00:00.000Z', '2d ago'],
    ['2026-08-27T12:00:00.000Z', '2w ago'],
  ])('renders %s as %s', (iso, expected) => {
    expect(relativeTime(iso, now)).toBe(expected);
  });

  it('falls back to a date once a relative age stops being useful', () => {
    expect(relativeTime('2026-01-02T12:00:00.000Z', now)).toBe(
      new Date('2026-01-02T12:00:00.000Z').toLocaleDateString(),
    );
  });

  it('returns nothing for an unparseable timestamp rather than "NaN ago"', () => {
    expect(relativeTime('not a date', now)).toBe('');
  });
});
