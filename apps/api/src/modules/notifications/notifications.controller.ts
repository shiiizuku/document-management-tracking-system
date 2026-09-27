import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth.guard.js';
import { CurrentUser } from '../../common/current-user.decorator.js';
import type { RequestUser } from '../../common/request-user.js';
import { DtsApplicationService } from '../application/dts-application.service.js';

@Controller('notifications')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly application: DtsApplicationService) {}
  @Get() list(@CurrentUser() actor: RequestUser, @Query('after') after?: string) {
    return {
      data: {
        items: this.application.listNotifications(actor, after ? Number(after) : 0),
        unreadCount: this.application.unreadNotificationCount(actor),
      },
    };
  }
  @Post(':id/read') read(@CurrentUser() actor: RequestUser, @Param('id') id: string) {
    return { data: this.application.markNotificationRead(actor, id) };
  }
}
