import { Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}
  @Get() list(@CurrentUser() user: AuthUser) { return this.notifications.list(user.id); }
  @Get('unread-count') unreadCount(@CurrentUser() user: AuthUser) { return this.notifications.unreadCount(user.id); }
  @Patch(':id/read') markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.notifications.markRead(user.id, id); }
  @Post('read-all') markAllRead(@CurrentUser() user: AuthUser) { return this.notifications.markAllRead(user.id); }
}
