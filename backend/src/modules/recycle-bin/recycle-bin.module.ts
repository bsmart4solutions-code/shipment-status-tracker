import { Controller, Delete, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RECYCLABLE, RecycleBinService } from './recycle-bin.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('recycle-bin')
class RecycleBinController {
  constructor(private recycle: RecycleBinService) {}

  /** List soft-deleted records, optionally filtered to one entity type. */
  @Get() @RequirePermission('recycle.read')
  list(@Query('entity') entity?: string) {
    return this.recycle.list(entity);
  }

  /** Restore a soft-deleted record back to active. */
  @Post(':entity/:id/restore') @RequirePermission('recycle.write')
  restore(@Param('entity') entity: string, @Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.recycle.restore(entity, id, user.id);
  }

  /** Permanently delete a record from the recycle bin (hard delete). */
  @Delete(':entity/:id') @RequirePermission('recycle.write')
  purge(@Param('entity') entity: string, @Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.recycle.purge(entity, id, user.id);
  }
}

// Re-export so seed / other modules can reference the recyclable set.
export { RECYCLABLE };

@Module({ controllers: [RecycleBinController], providers: [RecycleBinService] })
export class RecycleBinModule {}
