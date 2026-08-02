import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PayablesService } from '../payables/payables.service';
import { AddTrackingEventDto, AdvanceMilestoneDto, CreateJobDto, ListJobsDto, UpdateJobDto } from './jobs.dto';
import { JobsService } from './jobs.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('jobs')
export class JobsController {
  constructor(private jobs: JobsService, private payables: PayablesService) {}

  /**
   * Estimated / Recorded / Billed / Variance for one job. Read-only: vendor
   * bills are not the owner of Job.actualCost and this endpoint writes nothing.
   */
  @Get(':id/cost-variance') @RequirePermission('jobs.read')
  costVariance(@Param('id') id: string) {
    return this.payables.jobCostVariance(id);
  }

  @Get() @RequirePermission('jobs.read')
  list(@Query() dto: ListJobsDto) {
    return this.jobs.list(dto);
  }

  /** Shipments in transit with their next milestone (dashboard ops panel). */
  @Get('in-transit') @RequirePermission('jobs.read')
  inTransit() { return this.jobs.inTransit(); }

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

  /**
   * Advance the operational milestone (Sprint 06). Separate from the free-text
   * tracking endpoint above: this one is validated against the fixed sequence.
   */
  @Post(':id/milestone') @RequirePermission('jobs.write')
  advanceMilestone(@Param('id') id: string, @Body() dto: AdvanceMilestoneDto, @CurrentUser() user: { id: string }) {
    return this.jobs.advanceMilestone(id, dto, user.id);
  }
}
