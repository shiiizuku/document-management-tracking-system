import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsPanel } from '../src/components/notifications-panel';
import type { Notification } from '../src/lib/notifications';

const notification = (overrides: Partial<Notification> = {}): Notification => ({
  id: 'n1',
  type: 'DOCUMENT_ASSIGNED',
  title: 'Document assigned',
  body: 'DTS-2026-000001: Incoming letter',
  documentId: 'doc-1',
  readAt: null,
  createdAt: new Date().toISOString(),
  ...overrides,
});

const noop = () => undefined;

const renderPanel = (props: Partial<Parameters<typeof NotificationsPanel>[0]> = {}) =>
  render(
    <NotificationsPanel
      items={[notification()]}
      unreadCount={1}
      live
      onClose={noop}
      onMarkRead={noop}
      onMarkAllRead={noop}
      {...props}
    />,
  );

describe('NotificationsPanel', () => {
  it('renders each notification and shows the empty state otherwise', () => {
    const { rerender } = renderPanel();
    expect(screen.getByText('Document assigned')).toBeInTheDocument();

    rerender(
      <NotificationsPanel
        items={[]}
        unreadCount={0}
        live={false}
        onClose={noop}
        onMarkRead={noop}
        onMarkAllRead={noop}
      />,
    );
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it('marks a single notification read', async () => {
    const onMarkRead = vi.fn();
    renderPanel({ onMarkRead });
    await userEvent.click(screen.getByRole('button', { name: /mark .* as read/i }));
    expect(onMarkRead).toHaveBeenCalledWith('n1');
  });

  it('disables "mark all read" when nothing is unread', () => {
    renderPanel({ items: [notification({ readAt: new Date().toISOString() })], unreadCount: 0 });
    expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled();
  });

  it('opens the linked document and marks read when a row is clicked', async () => {
    const onOpenDocument = vi.fn();
    const onMarkRead = vi.fn();
    renderPanel({ onOpenDocument, onMarkRead });
    await userEvent.click(screen.getByText('DTS-2026-000001: Incoming letter'));
    expect(onMarkRead).toHaveBeenCalledWith('n1');
    expect(onOpenDocument).toHaveBeenCalledWith('doc-1');
  });
});
