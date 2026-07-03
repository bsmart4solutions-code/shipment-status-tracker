import { Body, Controller, Get, Module, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { NotificationsService } from './notifications.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications')
class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get() @RequirePermission('notifications.read')
  list(@CurrentUser() user: { id: string }, @Query('unread') unread?: string) {
    return this.notifications.list(user.id, unread === 'true');
  }

  @Post('scan') @RequirePermission('notifications.read')
  scan() { return this.notifications.scan(); }

  @Patch(':id/read') @RequirePermission('notifications.read')
  markRead(@Param('id') id: string) { return this.notifications.markRead(id); }

  @Patch('read-all') @RequirePermission('notifications.read')
  markAllRead(@CurrentUser() user: { id: string }) { return this.notifications.markAllRead(user.id); }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService] })
export class NotificationsModule {}
