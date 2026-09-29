import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { NotificationService } from './notification.service.js';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get() list(@CurrentUser() actor: RequestUser, @Query('after') after?: string) {
    return {
      data: {
        items: this.notifications.list(actor.id, after ? Number(after) : 0),
        unreadCount: this.notifications.unreadCount(actor.id),
      },
    };
  }

  @Post(':id/read') read(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: this.notifications.markRead(actor.id, id) };
  }
}
