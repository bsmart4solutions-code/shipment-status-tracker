import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AddTrackingEventDto, CreateJobDto, UpdateJobDto } from './jobs.dto';
import { JobsService } from './jobs.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobs')
export class JobsController {
  constructor(private jobs: JobsService) {}

  @Get() @RequirePermission('jobs.read')
  list(
    @Query() dto: PaginationDto,
    @Query('status') status?: string,
    @Query('customerId') customerId?: string,
    @Query('vendorId') vendorId?: string,
    @Query('origin') origin?: string,
    @Query('destination') destination?: string,
  ) {
    return this.jobs.list({ ...dto, status, customerId, vendorId, origin, destination });
  }

  @Get(':id') @RequirePermission('jobs.read')
  get(@Param('id') id: string) { return this.jobs.get(id); }

  @Post() @RequirePermission('jobs.write')
  create(@Body() dto: CreateJobDto) { return this.jobs.create(dto); }

  @Patch(':id') @RequirePermission('jobs.write')
  update(@Param('id') id: string, @Body() dto: UpdateJobDto) { return this.jobs.update(id, dto); }

  @Delete(':id') @RequirePermission('jobs.write')
  remove(@Param('id') id: string) { return this.jobs.remove(id); }

  // Document upload/list/download/extract live in DocumentsModule (binary
  // storage + template extraction). The old URL-only add/remove was replaced.

  @Get(':id/tracking') @RequirePermission('jobs.read')
  listTracking(@Param('id') id: string) { return this.jobs.listTracking(id); }

  @Post(':id/tracking') @RequirePermission('jobs.write')
  addTrackingEvent(@Param('id') id: string, @Body() dto: AddTrackingEventDto, @CurrentUser() user: { id: string }) {
    return this.jobs.addTrackingEvent(id, dto, user.id);
  }
}
