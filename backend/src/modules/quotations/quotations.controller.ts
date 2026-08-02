import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApprovalDecisionDto, CreateQuotationDto, ListQuotationsDto, SendEmailDto, SetStatusDto, UpdateQuotationDto } from './quotations.dto';
import { QuotationsService } from './quotations.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('quotations')
export class QuotationsController {
  constructor(private quotations: QuotationsService) {}

  @Get() @RequirePermission('quotations.read')
  list(@Query() dto: ListQuotationsDto) {
    return this.quotations.list(dto);
  }

  @Get(':id') @RequirePermission('quotations.read')
  get(@Param('id') id: string) { return this.quotations.get(id); }

  @Get(':id/revisions') @RequirePermission('quotations.read')
  revisions(@Param('id') id: string) { return this.quotations.revisions(id); }

  @Post() @RequirePermission('quotations.write')
  create(@Body() dto: CreateQuotationDto, @CurrentUser() user: { id: string }) {
    return this.quotations.create(dto, user.id);
  }

  @Put(':id') @RequirePermission('quotations.write')
  update(@Param('id') id: string, @Body() dto: UpdateQuotationDto, @CurrentUser() user: { id: string }) {
    return this.quotations.update(id, dto, user.id);
  }

  @Patch(':id/status') @RequirePermission('quotations.write')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() user: { id: string }) {
    return this.quotations.setStatus(id, dto.status, user.id);
  }

  // Quotation → Job conversion was replaced in Sprint 06 by
  // POST /bookings/from-quotation/:quotationId — a won quote is now booked
  // with a carrier first, and confirming that booking opens the shipment file.

  @Post(':id/email') @RequirePermission('quotations.write')
  email(@Param('id') id: string, @Body() dto: SendEmailDto, @CurrentUser() user: { id: string }) {
    return this.quotations.email(id, dto.to, dto.message, user.id);
  }

  @Post(':id/approve') @RequirePermission('approvals.write')
  approve(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: { id: string }) {
    return this.quotations.approve(id, dto.note, user.id);
  }

  @Post(':id/reject') @RequirePermission('approvals.write')
  reject(@Param('id') id: string, @Body() dto: ApprovalDecisionDto, @CurrentUser() user: { id: string }) {
    return this.quotations.reject(id, dto.note, user.id);
  }

  @Delete(':id') @RequirePermission('quotations.write')
  remove(@Param('id') id: string, @CurrentUser() user: { id: string }) {
    return this.quotations.remove(id, user.id);
  }
}
