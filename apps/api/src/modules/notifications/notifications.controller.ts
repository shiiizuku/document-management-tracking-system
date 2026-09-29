import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { NotificationsRepository, type NotificationRow } from './notifications.repository.js';

/** The wire shape of a notification; built by hand so no column leaks by accident. */
const toPublic = (row: NotificationRow) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  body: row.body,
  documentId: row.documentId,
  readAt: row.readAt,
  createdAt: row.createdAt,
});

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsRepository) {}

  @Get()
  async list(@CurrentUser() actor: RequestUser, @Query('cursor') cursor?: string) {
    const [page, unreadCount] = await Promise.all([
      this.notifications.list(actor.id, cursor ? { cursor } : {}),
      this.notifications.unreadCount(actor.id),
    ]);
    return {
      data: { items: page.items.map(toPublic), nextCursor: page.nextCursor, unreadCount },
    };
  }

  @Post('read-all')
  async readAll(@CurrentUser() actor: RequestUser) {
    const marked = await this.notifications.markAllRead(actor.id);
    return { data: { marked } };
  }

  @Post(':id/read')
  async read(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    const row = await this.notifications.markRead(actor.id, id);
    return { data: row === null ? null : toPublic(row) };
  }
}
